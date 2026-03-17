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
      'isTaxApplied?': mongoDoc.isTaxApplied ? 'Y' : 'N',
      Tax: Number(mongoDoc.taxPercentage) || 0,
      status: mongoDoc.status || 'Pending',
    }
  },
  toMongo(appSheetRow: any): Record<string, any> {
    const doc: Record<string, any> = {
      dealer: appSheetRow.dealer || '',
      phone: appSheetRow.phone || '',
      email: appSheetRow.email || '',
      address: appSheetRow.address || '',
      notes: appSheetRow.notes || '',
      status: appSheetRow.status || 'Pending',
      createdAt: appSheetRow.createdAt ? new Date(appSheetRow.createdAt) : new Date(),
      updatedAt: new Date(),
    }
    
    // Process isTaxApplied ONLY if the key exists in the AppSheet row
    const taxKeys = ['isTaxApplied?', 'isTaxApplied', 'IsTaxApplied', 'is tax applied', 'Tax Applied']
    const hasTaxKey = taxKeys.some(k => appSheetRow[k] !== undefined)
    if (hasTaxKey) {
      const val = appSheetRow['isTaxApplied?'] ?? appSheetRow['isTaxApplied'] ?? appSheetRow['IsTaxApplied'] ?? appSheetRow['is tax applied'] ?? appSheetRow['Tax Applied']
      if (val !== undefined && val !== null && val !== '') {
        const str = String(val).trim().toLowerCase()
        doc.isTaxApplied = str === 'y' || str === 'yes' || str === 'true' || val === true || val === 1
      } else {
        doc.isTaxApplied = false
      }
    }
    
    // Process Tax ONLY if the key exists
    const percKeys = ['Tax', 'tax', 'Tax Percentage', 'taxPercentage']
    const hasPercKey = percKeys.some(k => appSheetRow[k] !== undefined)
    if (hasPercKey) {
      doc.taxPercentage = Number(appSheetRow.Tax ?? appSheetRow.tax ?? appSheetRow['Tax Percentage'] ?? appSheetRow.taxPercentage) || 0
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
      vin: mongoDoc.vin || '',
      dealerServiceId: mongoDoc.dealerServiceId?.toString() || '',
      amount: Number(mongoDoc.amount) || 0,
      tax: Number(mongoDoc.tax) || 0,
      total: Number(mongoDoc.total) || 0,
      notes: mongoDoc.notes || '',
      isInvoiced: mongoDoc.isInvoiced === true ? 'Y' : 'N',
    }
  },
  toMongo(appSheetRow: any): Record<string, any> {
    return {
      dealer: appSheetRow.dealer || '',
      date: appSheetRow.date ? new Date(appSheetRow.date) : new Date(),
      stockNumber: appSheetRow.stockNumber || '',
      vin: appSheetRow.vin || '',
      dealerServiceId: appSheetRow.dealerServiceId || '',
      amount: Number(appSheetRow.amount) || 0,
      tax: Number(appSheetRow.tax) || 0,
      total: Number(appSheetRow.total) || 0,
      notes: appSheetRow.notes || '',
      isInvoiced: appSheetRow.isInvoiced === 'Y' || appSheetRow.isInvoiced === true,
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
