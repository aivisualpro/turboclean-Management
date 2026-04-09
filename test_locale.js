const start = Date.now();
for(let i=0; i<50000; i++) {
  const dateObj = new Date(Date.UTC(2026, 3, i % 30));
  const month = dateObj.toLocaleString('default', { month: 'short', timeZone: 'UTC' });
}
console.log("Time taken:", Date.now() - start, "ms");
