<script setup lang="ts">
import * as THREE from 'three'

definePageMeta({
  layout: 'blank',
})

const canvasRef = ref<HTMLCanvasElement | null>(null)
const wiperRef = ref<HTMLCanvasElement | null>(null)
let animationId: number
let wiperStepFn: ((t: number) => void) | null = null

onMounted(() => {
  if (!canvasRef.value) return

  const canvas = canvasRef.value
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000)
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  // ─── 1. WATER BUBBLES — Translucent spheres rising ─────────
  const bubbleCount = 60
  const bubbleGroup = new THREE.Group()
  const bubbles: { mesh: THREE.Mesh; speed: number; drift: number; phase: number; wobble: number }[] = []

  const bubbleGeo = new THREE.SphereGeometry(1, 24, 24)
  const bubbleTextures = [
    new THREE.Color('#4fc3f7'),
    new THREE.Color('#29b6f6'),
    new THREE.Color('#81d4fa'),
    new THREE.Color('#b3e5fc'),
    new THREE.Color('#00bcd4'),
  ]

  for (let i = 0; i < bubbleCount; i++) {
    const radius = Math.random() * 0.15 + 0.05
    const mat = new THREE.MeshBasicMaterial({
      color: bubbleTextures[Math.floor(Math.random() * bubbleTextures.length)],
      transparent: true,
      opacity: Math.random() * 0.25 + 0.08,
    })
    const mesh = new THREE.Mesh(bubbleGeo, mat)
    mesh.scale.setScalar(radius)
    mesh.position.set(
      (Math.random() - 0.5) * 25,
      (Math.random() - 0.5) * 25 - 5,
      (Math.random() - 0.5) * 15 - 8,
    )
    bubbleGroup.add(mesh)
    bubbles.push({
      mesh,
      speed: Math.random() * 0.008 + 0.003,
      drift: (Math.random() - 0.5) * 0.003,
      phase: Math.random() * Math.PI * 2,
      wobble: Math.random() * 0.5 + 0.3,
    })
  }
  scene.add(bubbleGroup)

  // Larger hero bubbles closer to camera for depth
  for (let i = 0; i < 8; i++) {
    const radius = Math.random() * 0.35 + 0.2
    const mat = new THREE.MeshBasicMaterial({
      color: bubbleTextures[Math.floor(Math.random() * bubbleTextures.length)],
      transparent: true,
      opacity: Math.random() * 0.08 + 0.03,
    })
    const mesh = new THREE.Mesh(bubbleGeo, mat)
    mesh.scale.setScalar(radius)
    mesh.position.set(
      (Math.random() - 0.5) * 18,
      (Math.random() - 0.5) * 14 - 3,
      (Math.random() - 0.5) * 6 - 3,
    )
    bubbleGroup.add(mesh)
    bubbles.push({
      mesh,
      speed: Math.random() * 0.004 + 0.002,
      drift: (Math.random() - 0.5) * 0.002,
      phase: Math.random() * Math.PI * 2,
      wobble: Math.random() * 0.8 + 0.4,
    })
  }

  // ─── 2. SPARKLE PARTICLES — Car shine glints ──────────────
  const sparkleCount = 800
  const sparkleGeo = new THREE.BufferGeometry()
  const sparklePos = new Float32Array(sparkleCount * 3)
  const sparkleSizes = new Float32Array(sparkleCount)
  const sparkleColors = new Float32Array(sparkleCount * 3)
  const sparklePhases = new Float32Array(sparkleCount)

  const sparkPalette = [
    new THREE.Color('#ffffff'),
    new THREE.Color('#fffde7'),
    new THREE.Color('#e0f7fa'),
    new THREE.Color('#f5a623'),
    new THREE.Color('#b3e5fc'),
  ]

  for (let i = 0; i < sparkleCount; i++) {
    sparklePos[i * 3] = (Math.random() - 0.5) * 50
    sparklePos[i * 3 + 1] = (Math.random() - 0.5) * 40
    sparklePos[i * 3 + 2] = (Math.random() - 0.5) * 30 - 10
    sparkleSizes[i] = Math.random() * 2.5 + 0.5
    sparklePhases[i] = Math.random() * Math.PI * 2
    const c = sparkPalette[Math.floor(Math.random() * sparkPalette.length)]!
    sparkleColors[i * 3] = c.r
    sparkleColors[i * 3 + 1] = c.g
    sparkleColors[i * 3 + 2] = c.b
  }

  sparkleGeo.setAttribute('position', new THREE.BufferAttribute(sparklePos, 3))
  sparkleGeo.setAttribute('size', new THREE.BufferAttribute(sparkleSizes, 1))
  sparkleGeo.setAttribute('color', new THREE.BufferAttribute(sparkleColors, 3))
  sparkleGeo.setAttribute('phase', new THREE.BufferAttribute(sparklePhases, 1))

  const sparkleMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute float size;
      attribute vec3 color;
      attribute float phase;
      varying vec3 vColor;
      varying float vAlpha;
      uniform float uTime;
      void main() {
        vColor = color;
        // Twinkle effect — each sparkle fades in and out at a different rate
        float twinkle = sin(uTime * 2.0 + phase * 6.283) * 0.5 + 0.5;
        twinkle = pow(twinkle, 3.0); // sharper sparkle bursts
        vAlpha = twinkle;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * twinkle * (180.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        // Bright center, soft falloff — like a light glint on a car surface
        float glow = exp(-d * 8.0);
        float alpha = glow * vAlpha * 0.7;
        gl_FragColor = vec4(vColor * (1.0 + glow * 0.5), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const sparkles = new THREE.Points(sparkleGeo, sparkleMat)
  scene.add(sparkles)

  // ─── 3. WATER RIPPLE RINGS — Expanding from random points ─
  const rippleGroup = new THREE.Group()
  const ripples: { mesh: THREE.Mesh; life: number; maxLife: number; speed: number }[] = []
  const rippleGeo = new THREE.RingGeometry(0.5, 0.55, 64)

  function spawnRipple() {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(0.55 + Math.random() * 0.08, 0.6, 0.7),
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(rippleGeo, mat)
    mesh.position.set(
      (Math.random() - 0.5) * 20,
      (Math.random() - 0.5) * 16,
      -12 - Math.random() * 8,
    )
    mesh.rotation.x = Math.random() * 0.3 - 0.15
    mesh.rotation.y = Math.random() * 0.3 - 0.15
    rippleGroup.add(mesh)
    ripples.push({
      mesh,
      life: 0,
      maxLife: 3 + Math.random() * 2,
      speed: 0.8 + Math.random() * 0.5,
    })
  }

  scene.add(rippleGroup)
  // Pre-spawn some ripples
  for (let i = 0; i < 6; i++) spawnRipple()

  // ─── 4. WATER DROPLET TRAILS — Falling streaks ──────────
  const dropCount = 400
  const dropGeo = new THREE.BufferGeometry()
  const dropPos = new Float32Array(dropCount * 3)
  const dropVel = new Float32Array(dropCount)
  const dropSizes = new Float32Array(dropCount)

  for (let i = 0; i < dropCount; i++) {
    dropPos[i * 3] = (Math.random() - 0.5) * 40
    dropPos[i * 3 + 1] = Math.random() * 30 - 5
    dropPos[i * 3 + 2] = (Math.random() - 0.5) * 20 - 8
    dropVel[i] = Math.random() * 0.03 + 0.01
    dropSizes[i] = Math.random() * 1.5 + 0.3
  }

  dropGeo.setAttribute('position', new THREE.BufferAttribute(dropPos, 3))
  dropGeo.setAttribute('size', new THREE.BufferAttribute(dropSizes, 1))

  const dropMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute float size;
      varying float vAlpha;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (120.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
        vAlpha = 0.15 + size * 0.1;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        // Elongate vertically to look like a falling water drop
        uv.y *= 0.6;
        float d = length(uv);
        if (d > 0.5) discard;
        float alpha = smoothstep(0.5, 0.1, d) * vAlpha;
        vec3 dropColor = mix(vec3(0.4, 0.8, 1.0), vec3(0.7, 0.95, 1.0), smoothstep(0.3, 0.0, d));
        gl_FragColor = vec4(dropColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const drops = new THREE.Points(dropGeo, dropMat)
  scene.add(drops)

  // ─── 5. FOAM CLUSTER — Soap suds ring ─────────────────
  const foamGroup = new THREE.Group()
  const foamBubbles: { mesh: THREE.Mesh; basePos: THREE.Vector3; phase: number }[] = []
  const foamGeo = new THREE.SphereGeometry(1, 16, 16)

  for (let i = 0; i < 45; i++) {
    const angle = (i / 45) * Math.PI * 2 + (Math.random() - 0.5) * 0.3
    const radius = 6 + (Math.random() - 0.5) * 2.5
    const size = Math.random() * 0.12 + 0.04
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(0, 0, 0.9 + Math.random() * 0.1),
      transparent: true,
      opacity: Math.random() * 0.06 + 0.02,
    })
    const mesh = new THREE.Mesh(foamGeo, mat)
    const basePos = new THREE.Vector3(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius * 0.4 - 2,
      -15 + (Math.random() - 0.5) * 3,
    )
    mesh.position.copy(basePos)
    mesh.scale.setScalar(size)
    foamGroup.add(mesh)
    foamBubbles.push({ mesh, basePos, phase: Math.random() * Math.PI * 2 })
  }
  scene.add(foamGroup)

  camera.position.z = 10

  // Mouse parallax
  const mouse = { x: 0, y: 0 }
  function onMouseMove(e: MouseEvent) {
    mouse.x = (e.clientX / window.innerWidth - 0.5) * 2
    mouse.y = (e.clientY / window.innerHeight - 0.5) * 2
  }
  window.addEventListener('mousemove', onMouseMove)

  let rippleTimer = 0
  const clock = new THREE.Clock()

  function animate() {
    animationId = requestAnimationFrame(animate)
    const t = clock.getElapsedTime()
    const dt = clock.getDelta()

    // Update shader uniforms
    sparkleMat.uniforms.uTime!.value = t
    dropMat.uniforms.uTime!.value = t

    // Animate bubbles — rise, wobble, reset
    for (const b of bubbles) {
      b.mesh.position.y += b.speed
      b.mesh.position.x += Math.sin(t * b.wobble + b.phase) * 0.003 + b.drift
      b.mesh.position.z += Math.cos(t * b.wobble * 0.7 + b.phase) * 0.001
      // Subtle scale pulse — breathing bubble
      const pulse = 1 + Math.sin(t * 1.5 + b.phase) * 0.08
      const s = b.mesh.scale.x / pulse // base scale
      b.mesh.scale.setScalar(s * (1 + Math.sin(t * 1.5 + b.phase) * 0.08))

      if (b.mesh.position.y > 15) {
        b.mesh.position.y = -15
        b.mesh.position.x = (Math.random() - 0.5) * 25
      }
    }

    // Animate water drops — fall down
    const dPos = dropGeo.attributes.position!.array as Float32Array
    for (let i = 0; i < dropCount; i++) {
      dPos[i * 3 + 1]! -= dropVel[i]!
      if (dPos[i * 3 + 1]! < -18) {
        dPos[i * 3 + 1] = 18
        dPos[i * 3] = (Math.random() - 0.5) * 40
      }
    }
    dropGeo.attributes.position!.needsUpdate = true

    // Animate ripples — expand and fade
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i]!
      r.life += 0.016
      const progress = r.life / r.maxLife
      const scale = 1 + progress * r.speed * 8
      r.mesh.scale.setScalar(scale)
      const mat = r.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = 0.35 * (1 - progress) * (1 - progress)
      if (progress >= 1) {
        rippleGroup.remove(r.mesh)
        ripples.splice(i, 1)
      }
    }

    // Spawn new ripples periodically
    rippleTimer += 0.016
    if (rippleTimer > 0.8) {
      rippleTimer = 0
      if (ripples.length < 12) spawnRipple()
    }

    // Animate foam — gentle float
    for (const f of foamBubbles) {
      f.mesh.position.x = f.basePos.x + Math.sin(t * 0.4 + f.phase) * 0.3
      f.mesh.position.y = f.basePos.y + Math.cos(t * 0.3 + f.phase) * 0.2
    }
    foamGroup.rotation.z = t * 0.02

    // Sparkle field slow rotation
    sparkles.rotation.y = t * 0.01
    sparkles.rotation.x = Math.sin(t * 0.05) * 0.02

    // Mouse parallax
    camera.position.x += (mouse.x * 1.2 - camera.position.x) * 0.025
    camera.position.y += (-mouse.y * 0.8 - camera.position.y) * 0.025
    camera.lookAt(0, 0, -5)

    renderer.render(scene, camera)

    // Run wiper text animation
    if (wiperStepFn) wiperStepFn(t)
  }
  animate()

  // ─── WIPER TEXT ANIMATION ─────────────────────────────
  const wCvs = wiperRef.value
  if (wCvs) {
    const dpr = Math.min(window.devicePixelRatio, 2)
    const TW = 380, TH = 70
    wCvs.width = TW * dpr
    wCvs.height = TH * dpr
    wCvs.style.width = TW + 'px'
    wCvs.style.height = TH + 'px'
    const tCtx = wCvs.getContext('2d')!
    tCtx.scale(dpr, dpr)

    // Helper to make offscreen canvases
    function mkCvs(w: number, h: number) {
      const c = document.createElement('canvas')
      c.width = w * dpr; c.height = h * dpr
      const cx = c.getContext('2d')!
      cx.scale(dpr, dpr)
      return { c, cx }
    }

    const clean = mkCvs(TW, TH)
    const dirtCvs = mkCvs(TW, TH)
    const compCvs = mkCvs(TW, TH)

    // Draw clean golden text
    const tGrad = clean.cx.createLinearGradient(0, 8, 0, TH - 8)
    tGrad.addColorStop(0, '#ffd700')
    tGrad.addColorStop(0.35, '#ffcc00')
    tGrad.addColorStop(0.65, '#f5a623')
    tGrad.addColorStop(1, '#e8960c')
    clean.cx.font = 'bold 42px Inter, system-ui, sans-serif'
    clean.cx.textAlign = 'center'
    clean.cx.textBaseline = 'middle'
    clean.cx.shadowColor = 'rgba(245,166,35,0.5)'
    clean.cx.shadowBlur = 15
    clean.cx.fillStyle = tGrad
    clean.cx.fillText('TURBO CLEAN', TW / 2, TH / 2)
    clean.cx.shadowBlur = 0
    clean.cx.globalAlpha = 0.25
    clean.cx.fillStyle = '#fff'
    clean.cx.fillText('TURBO CLEAN', TW / 2, TH / 2 - 1)
    clean.cx.globalAlpha = 1

    // Generate dirt texture
    function genDirt() {
      const d = dirtCvs.cx
      d.clearRect(0, 0, TW, TH)
      d.fillStyle = 'rgba(50,38,22,0.82)'
      d.fillRect(0, 0, TW, TH)
      for (let i = 0; i < 700; i++) {
        const b = 25 + Math.random() * 55
        d.fillStyle = `rgba(${b},${b * 0.7 | 0},${b * 0.35 | 0},${Math.random() * 0.4 + 0.05})`
        d.fillRect(Math.random() * TW, Math.random() * TH, Math.random() * 4 + 0.5, Math.random() * 3 + 0.5)
      }
      for (let i = 0; i < 10; i++) {
        d.fillStyle = `rgba(40,30,15,${Math.random() * 0.2 + 0.05})`
        d.beginPath()
        d.ellipse(Math.random() * TW, Math.random() * TH, Math.random() * 25 + 8, Math.random() * 6 + 2, Math.random() * Math.PI, 0, Math.PI * 2)
        d.fill()
      }
      for (let i = 0; i < 6; i++) {
        d.strokeStyle = `rgba(35,25,12,${Math.random() * 0.15 + 0.05})`
        d.lineWidth = Math.random() * 2 + 0.5
        d.beginPath()
        const sx = Math.random() * TW
        d.moveTo(sx, Math.random() * TH)
        d.lineTo(sx + (Math.random() - 0.5) * 60, Math.random() * TH)
        d.stroke()
      }
    }
    genDirt()

    // Wiper geometry
    const pX = TW / 2, pY = TH + 25
    const wLen = Math.hypot(TW / 2, TH + 25) + 15
    const RANGE = 1.15
    let wAngle = -RANGE, wDir = 1, wLast = -RANGE
    let wState: 'sweep' | 'hold' | 'refoul' = 'sweep'
    let wTimer = 0, dirtAlpha = 1
    const wdrops: { x: number; y: number; a: number; vy: number }[] = []
    let prevT = 0

    wiperStepFn = (t: number) => {
      const dt = prevT ? Math.min(t - prevT, 0.05) : 0.016
      prevT = t
      tCtx.clearRect(0, 0, TW, TH)

      // 1) Clean text
      tCtx.drawImage(clean.c, 0, 0, TW * dpr, TH * dpr, 0, 0, TW, TH)

      if (wState === 'sweep') {
        wAngle += wDir * 1.0 * dt
        // Erase dirt in swept arc
        dirtCvs.cx.globalCompositeOperation = 'destination-out'
        dirtCvs.cx.fillStyle = '#fff'
        dirtCvs.cx.beginPath()
        dirtCvs.cx.moveTo(pX, pY)
        const a1 = Math.min(wLast, wAngle) - Math.PI / 2
        const a2 = Math.max(wLast, wAngle) - Math.PI / 2
        dirtCvs.cx.arc(pX, pY, wLen, a1, a2)
        dirtCvs.cx.closePath()
        dirtCvs.cx.fill()
        dirtCvs.cx.globalCompositeOperation = 'source-over'
        // Water droplets
        if (Math.random() > 0.4) {
          const r = 0.3 + Math.random() * 0.5
          const bx = pX + Math.sin(wAngle) * wLen * r
          const by = pY - Math.cos(wAngle) * wLen * r
          if (by > 0 && by < TH && bx > 0 && bx < TW)
            wdrops.push({ x: bx, y: by, a: 0.35, vy: Math.random() * 0.3 + 0.1 })
        }
        wLast = wAngle
        if ((wDir > 0 && wAngle >= RANGE) || (wDir < 0 && wAngle <= -RANGE)) {
          wAngle = wDir > 0 ? RANGE : -RANGE
          wDir *= -1
          wState = 'hold'
          wTimer = 0
        }
      } else if (wState === 'hold') {
        wTimer += dt
        if (wTimer > 2.5) { wState = 'refoul'; wTimer = 0; dirtAlpha = 0; genDirt() }
      } else {
        wTimer += dt
        dirtAlpha = Math.min(1, wTimer / 1.5)
        if (dirtAlpha >= 1) {
          wAngle = -RANGE; wDir = 1; wLast = -RANGE
          wState = 'sweep'; wdrops.length = 0
        }
      }

      // 2) Dirt layer
      tCtx.globalAlpha = dirtAlpha
      tCtx.drawImage(dirtCvs.c, 0, 0, TW * dpr, TH * dpr, 0, 0, TW, TH)
      tCtx.globalAlpha = 1

      // 3) Water droplets
      for (let i = wdrops.length - 1; i >= 0; i--) {
        const d = wdrops[i]!
        d.y += d.vy; d.a -= 0.003
        if (d.a <= 0) { wdrops.splice(i, 1); continue }
        tCtx.fillStyle = `rgba(120,210,255,${d.a})`
        tCtx.beginPath()
        tCtx.arc(d.x, d.y, 1.5, 0, Math.PI * 2)
        tCtx.fill()
      }

      // 4) Wiper blade
      if (wState === 'sweep') {
        tCtx.save()
        tCtx.translate(pX, pY)
        tCtx.rotate(wAngle)
        tCtx.strokeStyle = 'rgba(120,120,130,0.5)'
        tCtx.lineWidth = 1.5
        tCtx.beginPath(); tCtx.moveTo(0, 0); tCtx.lineTo(0, -wLen); tCtx.stroke()
        tCtx.strokeStyle = 'rgba(30,30,35,0.85)'
        tCtx.lineWidth = 3.5
        tCtx.lineCap = 'round'
        tCtx.beginPath(); tCtx.moveTo(-16, -wLen + 10); tCtx.lineTo(16, -wLen + 10); tCtx.stroke()
        tCtx.restore()
      }
    }
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  }
  window.addEventListener('resize', onResize)

  onBeforeUnmount(() => {
    cancelAnimationFrame(animationId)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('resize', onResize)
    renderer.dispose()
  })
})
</script>

<template>
  <div class="login-page">
    <!-- Three.js Background -->
    <canvas ref="canvasRef" class="three-canvas" />

    <!-- Water-themed gradient overlays -->
    <div class="bg-overlay" />

    <!-- Content -->
    <div class="login-content">
      <div class="login-card-wrapper">
        <!-- Logo -->
        <NuxtLink to="/" class="logo-link">
          <div class="logo-glow" />
          <img src="/logo.png" alt="Turbo Clean Management" class="logo-img" />
        </NuxtLink>

        <!-- Welcome text -->
        <div class="welcome-text">
          <h1>Welcome back</h1>
        </div>

        <!-- Wiper text animation -->
        <canvas ref="wiperRef" class="wiper-canvas" />

        <!-- Login Card -->
        <div class="login-card">
          <AuthSignIn />
        </div>

        <!-- Footer -->
        <p class="login-footer">
          Turbo Clean Management &copy; {{ new Date().getFullYear() }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  position: relative;
  min-height: 100svh;
  overflow: hidden;
  background: linear-gradient(160deg, #050d1a 0%, #0a1628 30%, #0c1e3a 60%, #061224 100%);
}

.three-canvas {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
}

.bg-overlay {
  position: fixed;
  inset: 0;
  z-index: 1;
  background:
    radial-gradient(ellipse at 50% 20%, rgba(79, 195, 247, 0.06) 0%, transparent 55%),
    radial-gradient(ellipse at 20% 80%, rgba(0, 188, 212, 0.04) 0%, transparent 45%),
    radial-gradient(ellipse at 80% 60%, rgba(245, 166, 35, 0.04) 0%, transparent 40%),
    radial-gradient(ellipse at 50% 100%, rgba(0, 30, 80, 0.5) 0%, transparent 50%);
  pointer-events: none;
}

.login-content {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100svh;
  padding: 2rem;
}

.login-card-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  width: 100%;
  max-width: 400px;
  animation: fadeInUp 1s ease-out;
}

.logo-link {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.logo-link:hover {
  transform: scale(1.05);
}

.logo-glow {
  position: absolute;
  width: 180px;
  height: 180px;
  border-radius: 50%;
  background: radial-gradient(circle,
    rgba(79, 195, 247, 0.2) 0%,
    rgba(245, 166, 35, 0.15) 30%,
    rgba(0, 188, 212, 0.08) 50%,
    transparent 70%
  );
  filter: blur(25px);
  animation: pulseGlow 4s ease-in-out infinite;
}

.logo-img {
  position: relative;
  height: 130px;
  width: auto;
  filter:
    drop-shadow(0 0 20px rgba(79, 195, 247, 0.3))
    drop-shadow(0 0 40px rgba(245, 166, 35, 0.2))
    drop-shadow(0 0 80px rgba(0, 188, 212, 0.1));
  animation: floatLogo 5s ease-in-out infinite;
}

.welcome-text {
  text-align: center;
}

.welcome-text h1 {
  font-size: 1.75rem;
  font-weight: 700;
  color: #fff;
  letter-spacing: -0.02em;
  margin: 0;
}

.welcome-text p {
  font-size: 0.875rem;
  color: rgba(180, 210, 240, 0.5);
  margin: 0.375rem 0 0;
}

.wiper-canvas {
  border-radius: 0.5rem;
  overflow: hidden;
  display: block;
  max-width: 100%;
}

.welcome-sub {
  font-size: 0.875rem;
  color: rgba(180, 210, 240, 0.45);
  margin: 0;
  text-align: center;
}

.login-card {
  width: 100%;
  padding: 2rem;
  border-radius: 1rem;
  background: rgba(10, 30, 60, 0.5);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(79, 195, 247, 0.1);
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.3),
    0 24px 48px -12px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(79, 195, 247, 0.06),
    0 0 60px -20px rgba(79, 195, 247, 0.08);
}

/* Override form styles for dark water theme */
.login-card :deep(label) {
  color: rgba(200, 225, 255, 0.8);
  font-size: 0.8125rem;
  font-weight: 500;
}

.login-card :deep(input) {
  background: rgba(79, 195, 247, 0.04);
  border: 1px solid rgba(79, 195, 247, 0.12);
  color: #e0f0ff;
  border-radius: 0.625rem;
  padding: 0.625rem 0.875rem;
  font-size: 0.875rem;
  transition: all 0.2s ease;
}

.login-card :deep(input:focus) {
  border-color: rgba(79, 195, 247, 0.4);
  box-shadow: 0 0 0 3px rgba(79, 195, 247, 0.1);
  outline: none;
}

.login-card :deep(input::placeholder) {
  color: rgba(150, 190, 230, 0.3);
}

.login-card :deep(button[type="submit"]),
.login-card :deep(button.w-full) {
  background: linear-gradient(135deg, #f5a623 0%, #e8960c 50%, #d4850a 100%);
  color: #000;
  font-weight: 600;
  border: none;
  border-radius: 0.625rem;
  padding: 0.625rem 1.25rem;
  font-size: 0.875rem;
  transition: all 0.3s ease;
  box-shadow:
    0 4px 15px rgba(245, 166, 35, 0.3),
    0 0 30px rgba(245, 166, 35, 0.1);
  cursor: pointer;
}

.login-card :deep(button[type="submit"]:hover),
.login-card :deep(button.w-full:hover) {
  background: linear-gradient(135deg, #ffb733 0%, #f5a623 50%, #e8960c 100%);
  box-shadow:
    0 6px 25px rgba(245, 166, 35, 0.45),
    0 0 40px rgba(245, 166, 35, 0.15);
  transform: translateY(-1px);
}

.login-card :deep(a) {
  color: rgba(79, 195, 247, 0.7);
  text-decoration: none;
  font-size: 0.8125rem;
  transition: color 0.2s ease;
}

.login-card :deep(a:hover) {
  color: #4fc3f7;
}

.login-footer {
  font-size: 0.75rem;
  background: linear-gradient(135deg, #ffd700, #f5a623, #e8960c);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  opacity: 0.6;
  margin: 0;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes floatLogo {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  25% { transform: translateY(-6px) rotate(0.5deg); }
  50% { transform: translateY(-10px) rotate(0deg); }
  75% { transform: translateY(-4px) rotate(-0.5deg); }
}

@keyframes pulseGlow {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.2); }
}

@media (max-width: 640px) {
  .logo-img {
    height: 100px;
  }
  .logo-glow {
    width: 140px;
    height: 140px;
  }
  .welcome-text h1 {
    font-size: 1.5rem;
  }
  .login-card {
    padding: 1.5rem;
  }
}
</style>
