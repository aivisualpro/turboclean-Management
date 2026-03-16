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
      role: mongoDoc.role || 'User',
      status: mongoDoc.status || 'Active',
      password: mongoDoc.password || '',
      createdAt: mongoDoc.createdAt ? new Date(mongoDoc.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: mongoDoc.updatedAt ? new Date(mongoDoc.updatedAt).toISOString() : new Date().toISOString(),
    }
  },
  toMongo(appSheetRow: any): Record<string, any> {
    return {
      name: appSheetRow.name || '',
      email: appSheetRow.email || '',
      phone: appSheetRow.phone || '',
      address: appSheetRow.address || '',
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
      status: mongoDoc.status || 'Pending',
      createdAt: mongoDoc.createdAt ? new Date(mongoDoc.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: mongoDoc.updatedAt ? new Date(mongoDoc.updatedAt).toISOString() : new Date().toISOString(),
    }
  },
  toMongo(appSheetRow: any): Record<string, any> {
    return {
      dealer: appSheetRow.dealer || '',
      phone: appSheetRow.phone || '',
      email: appSheetRow.email || '',
      address: appSheetRow.address || '',
      notes: appSheetRow.notes || '',
      status: appSheetRow.status || 'Pending',
      createdAt: appSheetRow.createdAt ? new Date(appSheetRow.createdAt) : new Date(),
      updatedAt: new Date(),
    }
  },
}

// ─── DealerServices ──────────────────────────────────────────────
export const DealerServicesMapper = {
  toAppSheet(mongoDoc: any): Record<string, any> {
    return {
      _id: mongoDoc._id?.toString() || mongoDoc.id || '',
      dealer: mongoDoc.dealer?.toString() || '',
      service: mongoDoc.service?.toString() || '',
      amount: Number(mongoDoc.amount) || 0,
      tax: Number(mongoDoc.tax) || 0,
      total: Number(mongoDoc.total) || 0,
      createdAt: mongoDoc.createdAt ? new Date(mongoDoc.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: mongoDoc.updatedAt ? new Date(mongoDoc.updatedAt).toISOString() : new Date().toISOString(),
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
      price: Number(mongoDoc.price) || 0,
      tax: Number(mongoDoc.tax) || 0,
      createdAt: mongoDoc.createdAt ? new Date(mongoDoc.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: mongoDoc.updatedAt ? new Date(mongoDoc.updatedAt).toISOString() : new Date().toISOString(),
    }
  },
  toMongo(appSheetRow: any): Record<string, any> {
    return {
      service: appSheetRow.service || '',
      description: appSheetRow.description || '',
      price: Number(appSheetRow.price) || 0,
      tax: Number(appSheetRow.tax) || 0,
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
      createdAt: mongoDoc.createdAt ? new Date(mongoDoc.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: mongoDoc.updatedAt ? new Date(mongoDoc.updatedAt).toISOString() : new Date().toISOString(),
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
