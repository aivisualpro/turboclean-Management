/**
 * Sync Mapper: Converts data between MongoDB and AppSheet formats
 * Each table has a toAppSheet() and toMongo() function
 */

// ─── AppUsers ────────────────────────────────────────────────────
export const AppUsersMapper = {
  toAppSheet(mongoDoc: any): Record<string, any> {
    return {
      _id: mongoDoc._id?.toString() || '',
      name: mongoDoc.name || '',
      email: mongoDoc.email || '',
      phone: mongoDoc.phone || '',
      address: mongoDoc.address || '',
      registerDealers: Array.isArray(mongoDoc.registerDealers) ? mongoDoc.registerDealers.join(' , ') : '',
      role: mongoDoc.role || 'User',
      status: mongoDoc.status || 'Active',
      password: mongoDoc.password || '',
      createdAt: mongoDoc.createdAt ? new Date(mongoDoc.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: mongoDoc.updatedAt ? new Date(mongoDoc.updatedAt).toISOString() : new Date().toISOString(),
    }
  },
  toMongo(appSheetRow: any): Record<string, any> {
    // AppSheet stores registerDealers as comma-separated string
    const registerDealers = appSheetRow.registerDealers
      ? String(appSheetRow.registerDealers).split(/\s*,\s*/).filter(Boolean)
      : []
    return {
      name: appSheetRow.name || '',
      email: appSheetRow.email || '',
      phone: appSheetRow.phone || '',
      address: appSheetRow.address || '',
      registerDealers,
      role: appSheetRow.role || 'User',
      status: appSheetRow.status || 'Active',
      password: appSheetRow.password || '',
      createdAt: appSheetRow.createdAt ? new Date(appSheetRow.createdAt) : new Date(),
      updatedAt: new Date(),
    }
  },
}

// ─── Dealers ─────────────────────────────────────────────────────
export const DealersMapper = {
  toAppSheet(mongoDoc: any): Record<string, any> {
    return {
      _id: mongoDoc._id?.toString() || '',
      dealer: mongoDoc.dealer || '',
      phone: mongoDoc.phone || '',
      email: mongoDoc.email || '',
      address: mongoDoc.address || '',
      notes: mongoDoc.notes || '',
      isTaxApplied: mongoDoc.isTaxApplied === true ? 'Y' : 'N',
      taxPercentage: Number(mongoDoc.taxPercentage) || 0,
      status: mongoDoc.status || 'Pending',
    }
  },
  toMongo(appSheetRow: any): Record<string, any> {
    const doc: Record<string, any> = {
      updatedAt: new Date(),
    }

    if (appSheetRow.dealer !== undefined && appSheetRow.dealer !== null) doc.dealer = appSheetRow.dealer
    if (appSheetRow.phone !== undefined && appSheetRow.phone !== null) doc.phone = appSheetRow.phone
    if (appSheetRow.email !== undefined && appSheetRow.email !== null) doc.email = appSheetRow.email
    if (appSheetRow.address !== undefined && appSheetRow.address !== null) doc.address = appSheetRow.address
    if (appSheetRow.notes !== undefined && appSheetRow.notes !== null) doc.notes = appSheetRow.notes
    if (appSheetRow.status !== undefined && appSheetRow.status !== null) doc.status = appSheetRow.status
    if (appSheetRow.createdAt !== undefined && appSheetRow.createdAt !== null) doc.createdAt = new Date(appSheetRow.createdAt)

    if (appSheetRow.isTaxApplied !== undefined && appSheetRow.isTaxApplied !== null && appSheetRow.isTaxApplied !== '') {
      const v = appSheetRow.isTaxApplied
      doc.isTaxApplied = v === true || v === 1 || v === '1' || (typeof v === 'string' && ['true', 'yes', 'y'].includes(v.toLowerCase()))
      console.log(`[Mapper] Mapped isTaxApplied: raw="${v}" -> ${doc.isTaxApplied}`)
    }
    
    if (appSheetRow.taxPercentage !== undefined && appSheetRow.taxPercentage !== null && appSheetRow.taxPercentage !== '') {
      doc.taxPercentage = Number(appSheetRow.taxPercentage)
      console.log(`[Mapper] Mapped taxPercentage: raw="${appSheetRow.taxPercentage}" -> ${doc.taxPercentage}`)
    }

    return doc
  },
}

// ─── DealerServices ──────────────────────────────────────────────
export const DealerServicesMapper = {
  toAppSheet(mongoDoc: any): Record<string, any> {
    return {
      _id: mongoDoc._id?.toString() || mongoDoc.id || '',
      dealer: mongoDoc.dealer?.toString() || '',
      service: mongoDoc.service?.toString() || '',
      Amount: Number(mongoDoc.amount) || 0,
      Tax: Number(mongoDoc.tax) || 0,
      Total: Number(mongoDoc.total) || 0,
    }
  },
  toMongo(appSheetRow: any): Record<string, any> {
    return {
      dealer: appSheetRow.dealer || '',
      service: appSheetRow.service || '',
      amount: Number(appSheetRow.amount) || 0,
      tax: Number(appSheetRow.tax) || 0,
      total: Number(appSheetRow.total) || 0,
      createdAt: appSheetRow.createdAt ? new Date(appSheetRow.createdAt) : new Date(),
      updatedAt: new Date(),
    }
  },
}

// ─── Services ────────────────────────────────────────────────────
export const ServicesMapper = {
  toAppSheet(mongoDoc: any): Record<string, any> {
    return {
      _id: mongoDoc._id?.toString() || '',
      service: mongoDoc.service || '',
      description: mongoDoc.description || '',
    }
  },
  toMongo(appSheetRow: any): Record<string, any> {
    return {
      service: appSheetRow.service || '',
      description: appSheetRow.description || '',
      createdAt: appSheetRow.createdAt ? new Date(appSheetRow.createdAt) : new Date(),
      updatedAt: new Date(),
    }
  },
}

// ─── WorkOrders ──────────────────────────────────────────────────
export const WorkOrdersMapper = {
  toAppSheet(mongoDoc: any): Record<string, any> {
    return {
      _id: mongoDoc._id?.toString() || '',
      dealer: mongoDoc.dealer?.toString() || '',
      date: mongoDoc.date ? new Date(mongoDoc.date).toISOString() : new Date().toISOString(),
      stockNumber: mongoDoc.stockNumber || '',
      poNumber: mongoDoc.poNumber || '',
      vin: mongoDoc.vin || '',
      dealerServiceId: mongoDoc.dealerServiceId?.toString() || '',
      amount: Number(mongoDoc.amount) || 0,
      tax: Number(mongoDoc.tax) || 0,
      total: Number(mongoDoc.total) || 0,
      notes: mongoDoc.notes || '',
      isInvoiced: mongoDoc.isInvoiced === true ? 'Y' : 'N',
      isCustom: mongoDoc.isCustom === true ? 'Y' : 'N',
      Upload: mongoDoc.upload || '',
      lastUpdatedBy: mongoDoc.lastUpdatedBy || '',
    }
  },
  toMongo(appSheetRow: any): Record<string, any> {
    return {
      dealer: appSheetRow.dealer || '',
      date: appSheetRow.date ? new Date(appSheetRow.date) : new Date(),
      stockNumber: appSheetRow.stockNumber || '',
      poNumber: appSheetRow.poNumber || '',
      vin: appSheetRow.vin || '',
      dealerServiceId: appSheetRow.dealerServiceId || '',
      amount: parseFloat(String(appSheetRow.amount || '').replace(/[^\d.-]/g, '')) || 0,
      tax: parseFloat(String(appSheetRow.tax || '').replace(/[^\d.-]/g, '')) || 0,
      total: parseFloat(String(appSheetRow.total || '').replace(/[^\d.-]/g, '')) || 0,
      notes: appSheetRow.notes || '',
      isInvoiced: appSheetRow.isInvoiced === 'Y' || appSheetRow.isInvoiced === true,
      isCustom: appSheetRow.isCustom === 'Y' || appSheetRow.isCustom === true,
      upload: appSheetRow.Upload || '',
      lastUpdatedBy: appSheetRow.lastUpdatedBy || '',
      createdAt: appSheetRow.createdAt ? new Date(appSheetRow.createdAt) : new Date(),
      updatedAt: new Date(),
    }
  },
}

// ─── Lookup helper ───────────────────────────────────────────────
export const MAPPER_LOOKUP: Record<string, { toAppSheet: (doc: any) => Record<string, any>, toMongo: (row: any) => Record<string, any> }> = {
  AppUsers: AppUsersMapper,
  Dealers: DealersMapper,
  DealerServices: DealerServicesMapper,
  Services: ServicesMapper,
  WorkOrders: WorkOrdersMapper,
}
