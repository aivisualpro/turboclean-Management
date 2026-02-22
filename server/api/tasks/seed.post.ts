import { connectToDatabase } from '../../utils/mongodb'

export default defineEventHandler(async () => {
  const { db } = await connectToDatabase()
  const collection = db.collection('turboCleanTasks')

  // Clear existing tasks
  await collection.deleteMany({})

  const now = new Date()
  const today = now.toISOString().split('T')[0]

  const tasks = [
    // ── To Do ─────────────────────────────────────────
    { title: 'Schedule ceramic coating for BMW Waterbury fleet order', description: 'BMW Waterbury requested 9H Ceramic Coating for 12 new vehicles arriving next week. Need to block time slots and assign crew.', status: 'To Do', priority: 'high', labels: ['scheduling', 'fleet'], dueDate: '2026-02-28', order: 0 },
    { title: 'Follow up on unpaid invoice INV-2026-00342 — Hoffman Toyota', description: 'Invoice is 15 days overdue for $2,340. Need to send reminder email and call accounting department.', status: 'To Do', priority: 'high', labels: ['billing', 'overdue'], dueDate: '2026-02-24', order: 1 },
    { title: 'Order interior cleaning supplies for next week', description: 'Running low on Armor All, leather conditioner, and microfiber towels. Submit purchase order to vendor.', status: 'To Do', priority: 'medium', labels: ['supplies'], dueDate: '2026-02-25', order: 2 },
    { title: 'Prepare weekly invoice batch for Mitchell dealers', description: 'Generate and review invoices for Mitchell CDJR, Mitchell Subaru, Mitchell VW, and Mitchell Volvo for this week\'s work orders.', status: 'To Do', priority: 'high', labels: ['billing', 'weekly'], dueDate: '2026-02-23', order: 3 },
    { title: 'Coordinate new car delivery schedule with Land Rover Hartford', description: 'Land Rover has 8 new deliveries this week. Confirm timing with their sales team for detail prep.', status: 'To Do', priority: 'medium', labels: ['scheduling'], dueDate: '2026-02-26', order: 4 },
    { title: 'Train new detailer on ceramic coating application', description: 'New team member needs hands-on training for 9H ceramic coating process and quality standards.', status: 'To Do', priority: 'medium', labels: ['training'], dueDate: '2026-03-01', order: 5 },
    { title: 'Update pricing sheet for Hoffman Porsche services', description: 'Hoffman Porsche requested updated pricing for compound and wax, full detail, and ceramic coating packages.', status: 'To Do', priority: 'low', labels: ['pricing'], dueDate: '2026-03-03', order: 6 },
    { title: 'Replace buffer pads and polishing compound stock', description: 'Multiple pads are worn out. Order replacement set for compound and wax services. Check DA polisher condition.', status: 'To Do', priority: 'medium', labels: ['supplies', 'equipment'], dueDate: '2026-02-27', order: 7 },
    { title: 'Send monthly revenue report to management', description: 'Compile January sales data across all dealers — revenue by dealer, service breakdown, and comparison to last month.', status: 'To Do', priority: 'high', labels: ['reporting'], dueDate: '2026-02-24', order: 8 },
    { title: 'Inspect Mitchell Selig Ford detail bay ventilation', description: 'Crew reported poor airflow in the detail bay. Need to inspect and possibly request HVAC repair.', status: 'To Do', priority: 'low', labels: ['facility'], dueDate: '2026-03-05', order: 9 },
    { title: 'Set up work order import for Colonial New London', description: 'Colonial wants to start sending work orders via CSV. Need to configure import template and test with sample data.', status: 'To Do', priority: 'medium', labels: ['onboarding'], dueDate: '2026-02-28', order: 10 },
    { title: 'Review and approve expense reports from field team', description: 'Three team members submitted fuel and supply expenses for the week. Review receipts and approve for reimbursement.', status: 'To Do', priority: 'low', labels: ['admin'], dueDate: '2026-02-25', order: 11 },

    // ── In Progress ───────────────────────────────────
    { title: 'Buff and wet sand 5 vehicles at Hoffman Lexus', description: 'Ongoing job — 3 of 5 vehicles completed. Two remaining vehicles (IS 350 and RX 450h) scheduled for tomorrow.', status: 'In Progress', priority: 'high', labels: ['service', 'active'], dueDate: '2026-02-24', order: 0 },
    { title: 'Process decal removal batch for George Harte Nissan', description: 'Removing old dealer decals from 6 used cars. Currently working on vehicle #4. Should complete by end of shift.', status: 'In Progress', priority: 'medium', labels: ['service', 'active'], dueDate: '2026-02-23', order: 1 },
    { title: 'Full interior detail — ex-loaner fleet at Hoffman Honda', description: 'Full detail with pet hair removal for 4 ex-loaners. Includes steam cleaning, leather conditioning, and ozone treatment.', status: 'In Progress', priority: 'high', labels: ['service', 'fleet'], dueDate: '2026-02-24', order: 2 },
    { title: 'Generate weekly invoices for AUDI East Hartford', description: 'Pulling work orders from this week, grouping by service type, and preparing invoice for review before sending.', status: 'In Progress', priority: 'high', labels: ['billing'], dueDate: '2026-02-23', order: 3 },
    { title: 'Inventory check on cleaning chemical supplies', description: 'Counting stock of all-purpose cleaner, glass cleaner, wheel acid, and degreaser. Halfway through the stockroom.', status: 'In Progress', priority: 'medium', labels: ['supplies'], dueDate: '2026-02-23', order: 4 },
    { title: 'New car delivery prep — 3 vehicles at KIA East Hartford', description: 'Prepping 3 new Sportage models for customer delivery. Exterior wash, interior wipe-down, tire shine, window clean.', status: 'In Progress', priority: 'high', labels: ['service', 'delivery'], dueDate: '2026-02-23', order: 5 },
    { title: 'Coordinate with Manchester Mazda for Saturday detail schedule', description: 'They need 10 vehicles detailed on Saturday. Confirming crew availability and service scope for each vehicle.', status: 'In Progress', priority: 'medium', labels: ['scheduling'], dueDate: '2026-02-23', order: 6 },
    { title: 'Update work order import template for Vernon Chevrolet', description: 'Vernon requested column changes in their CSV import format. Modifying the import mappings now.', status: 'In Progress', priority: 'low', labels: ['admin', 'onboarding'], dueDate: '2026-02-25', order: 7 },
    { title: 'Compound and wax finish on 2 trade-ins — Mitchell CDJR', description: 'Paint correction and wax on a Ram 1500 and Jeep Grand Cherokee. Ram is done, Jeep in progress.', status: 'In Progress', priority: 'medium', labels: ['service', 'active'], dueDate: '2026-02-23', order: 8 },
    { title: 'Monthly tax calculation for January invoices', description: 'Compiling total tax collected across all invoices for January. Cross-referencing with work order totals.', status: 'In Progress', priority: 'high', labels: ['accounting'], dueDate: '2026-02-24', order: 9 },

    // ── In Review ─────────────────────────────────────
    { title: 'Quality check — ceramic coating on Hoffman Porsche Cayenne', description: 'Coating applied yesterday. Need 24-hour cure inspection before releasing vehicle back to the dealer.', status: 'In Review', priority: 'high', labels: ['quality', 'service'], dueDate: '2026-02-23', order: 0 },
    { title: 'Review invoice batch before sending to Ford of Northampton', description: '8 invoices ready for Ford of Northampton. Need manager sign-off on pricing and line items before emailing.', status: 'In Review', priority: 'high', labels: ['billing', 'review'], dueDate: '2026-02-23', order: 1 },
    { title: 'Inspect detail quality on ex-loaner batch — Hoffman Genesis', description: 'Team completed 6 ex-loaner details yesterday. Walk around each vehicle to verify interior and exterior quality.', status: 'In Review', priority: 'medium', labels: ['quality'], dueDate: '2026-02-23', order: 2 },
    { title: 'Verify work order data import accuracy for BMW Waterbury', description: 'New batch of 45 work orders imported via CSV. Spot-check VIN numbers, stock numbers, and amounts look correct.', status: 'In Review', priority: 'medium', labels: ['admin', 'data'], dueDate: '2026-02-23', order: 3 },
    { title: 'Approve new service pricing for Terryville Chevrolet', description: 'Updated pricing proposal sent. Waiting for dealer manager to confirm new rates for 2026.', status: 'In Review', priority: 'low', labels: ['pricing', 'review'], dueDate: '2026-02-28', order: 4 },
    { title: 'Final walk-through — Saturday batch at Mitchell Subaru', description: 'Completed 7 vehicles — express clean and tire detail. Quick walk-through before dealer opens Monday.', status: 'In Review', priority: 'medium', labels: ['quality', 'service'], dueDate: '2026-02-24', order: 5 },

    // ── Done ──────────────────────────────────────────
    { title: 'Completed express clean x15 at Hoffman Toyota', description: 'All 15 vehicles from Monday\'s batch are done and released. Invoice sent — $1,125 total.', status: 'Done', priority: 'medium', labels: ['service', 'completed'], dueDate: '2026-02-21', order: 0 },
    { title: 'Installed ceramic coating on 3 vehicles — AUDI East Hartford', description: '9H Ceramic Coating applied to Q5, A6, and e-tron GT. All passed inspection. Total: $2,700.', status: 'Done', priority: 'high', labels: ['service', 'completed'], dueDate: '2026-02-20', order: 1 },
    { title: 'Resolved invoice discrepancy with George Harte Nissan', description: 'They flagged a $200 overcharge on INV-2026-00289. Verified it was a duplicate line item — issued credit memo.', status: 'Done', priority: 'high', labels: ['billing', 'resolved'], dueDate: '2026-02-19', order: 2 },
    { title: 'Completed onboarding for new detailer — Mike R.', description: 'Finished 3-day training program covering new delivery prep, interior detail, and ceramic coating basics.', status: 'Done', priority: 'medium', labels: ['training', 'hr'], dueDate: '2026-02-18', order: 3 },
    { title: 'Monthly supplies order delivered and stocked', description: 'All cleaning chemicals, microfibers, and applicators received from vendor. Inventory updated in system.', status: 'Done', priority: 'low', labels: ['supplies'], dueDate: '2026-02-17', order: 4 },
    { title: 'Compounded and polished showroom vehicles — Hoffman Porsche', description: 'Full paint correction on 4 showroom vehicles. Completed compound, polish, and sealant. Dealer very satisfied.', status: 'Done', priority: 'high', labels: ['service', 'completed'], dueDate: '2026-02-16', order: 5 },
    { title: 'Set up new dealer account — Mitchell Volvo', description: 'Created dealer profile, configured services (New Delivery, Used Detail, Express Clean), and imported first batch of work orders.', status: 'Done', priority: 'medium', labels: ['onboarding'], dueDate: '2026-02-15', order: 6 },
    { title: 'Fixed work order import validation for VIN field', description: 'CSV import was accepting 10-char VINs. Updated validation to handle partial VINs from dealer exports.', status: 'Done', priority: 'low', labels: ['bug', 'admin'], dueDate: '2026-02-14', order: 7 },
    { title: 'Sent January revenue summary to all dealers', description: 'Generated and emailed individual monthly statements showing work orders, services, and total amounts per dealer.', status: 'Done', priority: 'medium', labels: ['reporting', 'billing'], dueDate: '2026-02-12', order: 8 },
    { title: 'Completed fleet detail — 20 vehicles at Land Rover Hartford', description: 'Full interior and exterior detail on all 20 units. 3-day job completed on schedule. Invoiced $7,500.', status: 'Done', priority: 'high', labels: ['service', 'fleet', 'completed'], dueDate: '2026-02-10', order: 9 },
    { title: 'Updated dashboard KPIs for dealers and services tabs', description: 'Added tab-specific KPI cards showing relevant metrics for each view — total dealers, avg revenue, top performers.', status: 'Done', priority: 'low', labels: ['feature', 'dashboard'], dueDate: '2026-02-09', order: 10 },
    { title: 'Resolved ozone machine malfunction at KIA East Hartford', description: 'Machine was not cycling properly. Replaced filter and reset timer. Back in operation for interior treatments.', status: 'Done', priority: 'medium', labels: ['equipment', 'resolved'], dueDate: '2026-02-08', order: 11 },

    // ── Additional tasks to reach 50 ─────────────────
    { title: 'Negotiate bulk discount with Armor All supplier', description: 'We\'re using 20+ cases/month. Contact rep at CleanPro Distribution to discuss volume pricing for 2026.', status: 'To Do', priority: 'low', labels: ['supplies', 'negotiation'], dueDate: '2026-03-07', order: 12 },
    { title: 'Schedule quarterly equipment maintenance', description: 'DA polishers, steam cleaners, and ozone machines need quarterly servicing. Book technician for March 1st week.', status: 'To Do', priority: 'medium', labels: ['equipment', 'maintenance'], dueDate: '2026-03-01', order: 13 },
    { title: 'Create employee performance reviews for Q1', description: 'Prepare review forms for 6 detailers based on work order volume, quality feedback, and attendance records.', status: 'To Do', priority: 'medium', labels: ['hr', 'admin'], dueDate: '2026-03-15', order: 14 },
    { title: 'Engine bay detail + tire dressing — 4 units at Hoffman Ford', description: 'Custom engine + tires package for 4 F-150s on the used lot. Two completed, two remaining for this afternoon.', status: 'In Progress', priority: 'medium', labels: ['service', 'active'], dueDate: '2026-02-23', order: 10 },
    { title: 'Prepare dealer onboarding packet for new client', description: 'New dealer (Stamford BMW) interested in services. Preparing service menu, pricing, and work order submission process.', status: 'In Progress', priority: 'high', labels: ['onboarding', 'sales'], dueDate: '2026-02-26', order: 11 },
    { title: 'Review employee time cards for payroll processing', description: 'Cross-check time sheets submitted by 8 team members against the work order schedule. Flag any discrepancies.', status: 'In Review', priority: 'high', labels: ['hr', 'payroll'], dueDate: '2026-02-23', order: 6 },
    { title: 'Sign-off on new express clean process document', description: 'Updated SOP for express clean service — includes checklist, time targets, and quality benchmarks. Needs final approval.', status: 'In Review', priority: 'low', labels: ['documentation', 'process'], dueDate: '2026-02-28', order: 7 },
    { title: 'Delivered 8 fully detailed trade-ins — Mitchell VW', description: 'Used Detail package completed on 8 CPO vehicles. All passed dealer inspection on first review.', status: 'Done', priority: 'high', labels: ['service', 'completed'], dueDate: '2026-02-07', order: 12 },
    { title: 'Configured automated invoice reminders for overdue accounts', description: 'Set up system to flag invoices 14+ days past due and auto-generate reminder email templates.', status: 'Done', priority: 'medium', labels: ['feature', 'billing'], dueDate: '2026-02-06', order: 13 },
    { title: 'Completed deep clean and ionize on 5 service loaners — Hoffman Lexus', description: 'Full deep clean with ionizer treatment for 5 loaner vehicles returned with pet hair and odor. All cleared.', status: 'Done', priority: 'medium', labels: ['service', 'completed'], dueDate: '2026-02-05', order: 14 },
  ]

  // Add createdAt to each task
  const tasksWithTimestamps = tasks.map((t, i) => ({
    ...t,
    createdAt: new Date(now.getTime() - (tasks.length - i) * 3600000).toISOString(), // stagger by 1 hour
  }))

  const result = await collection.insertMany(tasksWithTimestamps)

  return {
    success: true,
    inserted: result.insertedCount,
    message: `Seeded ${result.insertedCount} realistic tasks across To Do, In Progress, In Review, and Done columns`,
  }
})
