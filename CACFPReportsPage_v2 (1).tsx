import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'

// ── Types ──────────────────────────────────────────────────────────────────
type ReportTab = 'regular' | 'beginning' | 'ending' | 'other_costs' | 'inv_food' | 'inv_nonfood'

type Receipt = {
  id: string
  receipt_date: string
  vendor: string
  food_amt: number | null
  nonfood_amt: number | null
  milk_whole: number | null
  milk_skim: number | null
  milk_pct1: number | null
  fiscal_month: string
}

type SnapItem = {
  product_name: string
  package_label: string | null
  packages_on_hand: number
  unit_cost: number | null
  total_cost: number
  is_food: boolean
}

type OtherCosts = {
  adm: { pos: string; h: string; w: string }[]
  lab: { pos: string; h: string; w: string }[]
  lab_staff: string
  del: { pos: string; h: string; w: string }[]
  svc: { co: string; pct: string; bill: string }[]
  utl: { item: string; pct: string; bill: string }[]
  dep: { item: string; amt: string }[]
}

type IssueLevel = 'error' | 'warning'
type Issue = {
  level: IssueLevel
  code: string
  title: string
  detail: string
  tab?: ReportTab
}

// ── Constants ──────────────────────────────────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_LABELS: Record<string,string> = {
  '01':'January','02':'February','03':'March','04':'April','05':'May','06':'June',
  '07':'July','08':'August','09':'September','10':'October','11':'November','12':'December'
}
const PEARL_CENTER_ID = '881ef4ce-1a27-4d3b-aa60-59d2a307bf2b'

// Tab → form file mapping
const TAB_FORM: Record<ReportTab, string> = {
  regular:     '/forms/FoodCostWorksheet.html',
  beginning:   '/forms/FoodCostWorksheet_Beginning.html',
  ending:      '/forms/FoodCostWorksheet_Ending.html',
  other_costs: '/forms/OtherMonthlyCosts_Template.html',
  inv_food:    '/forms/Sep_Food_Inventory.html',
  inv_nonfood: '/forms/Sep_NonFood_Inventory.html',
}

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt$(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return '$0.00'
  return '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
function n(s: string | undefined): number {
  const v = parseFloat(s || '0')
  return isNaN(v) ? 0 : v
}

// ── Styles ─────────────────────────────────────────────────────────────────
const S = {
  page:      { padding:'24px 32px', fontFamily:"'DM Sans', sans-serif", background:'#f4f6f4', minHeight:'100vh' } as React.CSSProperties,
  title:     { fontFamily:"'DM Serif Display', serif", fontSize:26, color:'#0a3320', marginBottom:2 } as React.CSSProperties,
  sub:       { fontSize:12, color:'#888', marginBottom:20 } as React.CSSProperties,
  select:    { padding:'7px 10px', borderRadius:8, border:'1px solid #ddd', fontSize:13, fontFamily:'inherit', outline:'none' } as React.CSSProperties,
  printBtn:  { padding:'9px 20px', borderRadius:8, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:'inherit', background:'#0a3320', color:'#fff' } as React.CSSProperties,
  tabBtn:    (a: boolean): React.CSSProperties => ({ padding:'7px 14px', borderRadius:7, border:'none', cursor:'pointer', fontSize:12, fontWeight:500, fontFamily:'inherit', background:a?'#0a3320':'transparent', color:a?'#fff':'#555', whiteSpace:'nowrap' as const }),
  tabs:      { display:'flex', gap:4, background:'#fff', padding:5, borderRadius:10, border:'1px solid #e0e0e0', flexWrap:'wrap' as const, marginBottom:20 } as React.CSSProperties,
  statCard:  { background:'#fff', borderRadius:10, border:'1px solid #e0e0e0', padding:'10px 16px', textAlign:'center' as const, minWidth:120 } as React.CSSProperties,
}

const css = `
  @media print { .no-print { display: none !important; } body { background: white !important; } }
`

// ── Validation ─────────────────────────────────────────────────────────────
function runValidation(params: {
  month: string; year: string; receipts: Receipt[]
  snapItems: SnapItem[]; snapFood: number; snapNonFood: number; totalFood: number; totalNonFood: number
  otherCosts: OtherCosts | null
}): Issue[] {
  const { month, year, receipts, snapItems, snapFood, snapNonFood, totalFood } = params
  const issues: Issue[] = []
  const mon = parseInt(month, 10)
  const isSep = mon === 9
  const isOct = mon === 10

  if (isSep && snapItems.length === 0) {
    issues.push({ level:'error', code:'NO_INVENTORY_SEP', tab:'inv_food',
      title:'September 30 inventory not recorded',
      detail:'The Ending (Sep) form requires an inventory snapshot on Sep 30 to calculate actual food cost. Record inventory in Kitchen Stock before closing.' })
  }
  if (isOct && snapItems.length === 0) {
    issues.push({ level:'error', code:'NO_INVENTORY_OCT', tab:'beginning',
      title:'Sep 30 inventory missing for October',
      detail:'The Beginning (Oct) form adds Sep 30 inventory values to October purchases. Make sure September inventory was recorded.' })
  }

  const monthEnd = new Date(parseInt(year), mon, 0)
  const deadline = new Date(monthEnd)
  deadline.setDate(deadline.getDate() + 45)
  if (new Date() > deadline) {
    issues.push({ level:'error', code:'DEADLINE_PASSED',
      title:'Ohio DCY 45-day deadline has passed',
      detail:`The submission deadline for ${MONTH_LABELS[month]} ${year} was ${deadline.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}. Contact Ohio DCY before submitting a late claim.` })
  }

  if (receipts.length === 0) {
    issues.push({ level:'warning', code:'NO_RECEIPTS', tab:'regular',
      title:'No receipts found for this month',
      detail:'No food/non-food receipts were entered. This may happen if photos were not taken or OCR failed. Verify purchases in the bank statement.' })
  }
  if (receipts.length > 0 && totalFood === 0) {
    issues.push({ level:'warning', code:'ZERO_FOOD_TOTAL', tab:'regular',
      title:'Food total is $0 despite having receipts',
      detail:'Receipts were entered but all food amounts are $0. OCR may have failed to read receipt totals. Review each receipt.' })
  }
  const totalMilk = receipts.reduce((s,r) => s + (r.milk_whole||0) + (r.milk_skim||0) + (r.milk_pct1||0), 0)
  if (receipts.length > 0 && totalMilk === 0) {
    issues.push({ level:'warning', code:'NO_MILK', tab:'regular',
      title:'No milk gallons recorded',
      detail:'Milk purchases are tracked on each receipt for CACFP reporting. If milk was purchased this month, add gallon counts to the receipts.' })
  }
  return issues
}

// ── Close Month Modal ──────────────────────────────────────────────────────
function CloseMonthModal({ issues, month, year, onGoToTab, onConfirm, onCancel, saving }: {
  issues: Issue[]; month: string; year: string
  onGoToTab: (tab: ReportTab) => void
  onConfirm: (withWarnings: boolean) => void
  onCancel: () => void; saving: boolean
}) {
  const errors   = issues.filter(i => i.level === 'error')
  const warnings = issues.filter(i => i.level === 'warning')
  const hasErrors = errors.length > 0
  const monthName = MONTH_LABELS[month] || month

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:'#fff', borderRadius:16, padding:'28px 32px', maxWidth:620, width:'100%', maxHeight:'85vh', overflowY:'auto', boxShadow:'0 8px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:12, marginBottom:20 }}>
          <div style={{ fontSize:28 }}>{hasErrors ? '🚫' : warnings.length > 0 ? '⚠️' : '✅'}</div>
          <div>
            <div style={{ fontSize:18, fontWeight:700, color:'#0a3320', fontFamily:"'DM Serif Display', serif" }}>
              Close Month: {monthName} {year}
            </div>
            <div style={{ fontSize:13, color:'#888', marginTop:2 }}>
              {hasErrors ? `${errors.length} issue${errors.length>1?'s':''} must be resolved before closing`
                : warnings.length > 0 ? `${warnings.length} warning${warnings.length>1?'s':''} — review before closing`
                : 'All checks passed — ready to close'}
            </div>
          </div>
        </div>

        {errors.length > 0 && (
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#b00020', marginBottom:8, textTransform:'uppercase', letterSpacing:1 }}>❌ Required fixes ({errors.length})</div>
            {errors.map(issue => (
              <div key={issue.code} style={{ border:'1px solid #fcc', borderRadius:8, padding:'12px 14px', marginBottom:8, background:'#fff8f8' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                  <div>
                    <div style={{ fontWeight:600, color:'#b00020', fontSize:13 }}>{issue.title}</div>
                    <div style={{ fontSize:12, color:'#666', marginTop:3 }}>{issue.detail}</div>
                  </div>
                  {issue.tab && (
                    <button onClick={() => { onGoToTab(issue.tab!); onCancel() }}
                      style={{ flexShrink:0, padding:'5px 12px', borderRadius:6, border:'1px solid #fcc', background:'#fff', color:'#b00020', fontSize:12, cursor:'pointer', fontWeight:600, whiteSpace:'nowrap' }}>
                      Fix →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {warnings.length > 0 && (
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#e65100', marginBottom:8, textTransform:'uppercase', letterSpacing:1 }}>⚠️ Warnings ({warnings.length})</div>
            {warnings.map(issue => (
              <div key={issue.code} style={{ border:'1px solid #ffe082', borderRadius:8, padding:'12px 14px', marginBottom:8, background:'#fffde7' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                  <div>
                    <div style={{ fontWeight:600, color:'#7a5a00', fontSize:13 }}>{issue.title}</div>
                    <div style={{ fontSize:12, color:'#666', marginTop:3 }}>{issue.detail}</div>
                  </div>
                  {issue.tab && (
                    <button onClick={() => { onGoToTab(issue.tab!); onCancel() }}
                      style={{ flexShrink:0, padding:'5px 12px', borderRadius:6, border:'1px solid #ffe082', background:'#fff', color:'#7a5a00', fontSize:12, cursor:'pointer', fontWeight:600, whiteSpace:'nowrap' }}>
                      Review →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {issues.length === 0 && (
          <div style={{ border:'1px solid #c8e6c9', borderRadius:8, padding:'16px', background:'#f1f8f1', marginBottom:16, textAlign:'center', color:'#1a7a3a' }}>
            <div style={{ fontSize:32, marginBottom:4 }}>✅</div>
            <div style={{ fontWeight:600, fontSize:14 }}>All validation checks passed</div>
            <div style={{ fontSize:12, color:'#555', marginTop:4 }}>Ready to close {monthName} {year} and create a snapshot in monthly_claims.</div>
          </div>
        )}

        <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:8, flexWrap:'wrap' }}>
          <button onClick={onCancel} disabled={saving}
            style={{ padding:'9px 20px', borderRadius:8, border:'1px solid #ddd', background:'#fff', color:'#555', fontSize:13, cursor:'pointer', fontWeight:500 }}>
            Cancel
          </button>
          {!hasErrors && (
            <button onClick={() => onConfirm(warnings.length > 0)} disabled={saving}
              style={{ padding:'9px 24px', borderRadius:8, border:'none', background:saving?'#aaa':'#0a3320', color:'#fff', fontSize:13, cursor:saving?'default':'pointer', fontWeight:600, minWidth:160 }}>
              {saving ? 'Closing…' : warnings.length > 0 ? `Close with ${warnings.length} warning${warnings.length>1?'s':''}` : '✓ Close Month'}
            </button>
          )}
        </div>
        {hasErrors && (
          <div style={{ fontSize:11, color:'#b00020', textAlign:'center', marginTop:10 }}>
            Resolve all {errors.length} error{errors.length>1?'s':''} above before closing the month.
          </div>
        )}
      </div>
    </div>
  )
}

// ── FormIframe ─────────────────────────────────────────────────────────────
function FormIframe({ src, data, onPrint }: { src: string; data: object; onPrint?: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [loaded, setLoaded] = useState(false)

  const sendData = useCallback(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'cacfp-render', data }, '*')
    }
  }, [data])

  useEffect(() => {
    setLoaded(false)
  }, [src])

  useEffect(() => {
    if (loaded) sendData()
  }, [loaded, sendData])

  return (
    <div style={{ position:'relative' }}>
      {!loaded && (
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'#f9f9f9', borderRadius:8, minHeight:400 }}>
          <div style={{ color:'#888', fontSize:13 }}>Loading form…</div>
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={src}
        onLoad={() => setLoaded(true)}
        style={{ width:'100%', minHeight:700, border:'none', borderRadius:8, display:loaded?'block':'block', opacity:loaded?1:0, transition:'opacity 0.2s' }}
        title="CACFP Form"
      />
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function CACFPReportsPage() {
  const [tab,         setTab]         = useState<ReportTab>('regular')
  const [receipts,    setReceipts]    = useState<Receipt[]>([])
  const [snapItems,   setSnapItems]   = useState<SnapItem[]>([])
  const [otherCosts,  setOtherCosts]  = useState<OtherCosts | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [month,       setMonth]       = useState(() => String(new Date().getMonth() + 1).padStart(2, '0'))
  const [year,        setYear]        = useState(() => String(new Date().getFullYear()))
  const [showModal,   setShowModal]   = useState(false)
  const [issues,      setIssues]      = useState<Issue[]>([])
  const [saving,      setSaving]      = useState(false)
  const [closeStatus, setCloseStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const [closeMonth,  setCloseMonth]  = useState(month)

  // Derived totals
  const snapFood    = snapItems.filter(i =>  i.is_food).reduce((s,i) => s + i.total_cost, 0)
  const snapNonFood = snapItems.filter(i => !i.is_food).reduce((s,i) => s + i.total_cost, 0)
  const totalFood    = receipts.reduce((s,r) => s + (r.food_amt    || 0), 0)
  const totalNonFood = receipts.reduce((s,r) => s + (r.nonfood_amt || 0), 0)
  const totalMilkW   = receipts.reduce((s,r) => s + (r.milk_whole  || 0), 0)
  const totalMilkS   = receipts.reduce((s,r) => s + (r.milk_skim   || 0), 0)
  const totalMilk1   = receipts.reduce((s,r) => s + (r.milk_pct1   || 0), 0)

  const load = useCallback(async () => {
    setLoading(true)
    setCloseStatus(null)
    const fiscalMonth = `${year}-${month}`
    const claimMonthInt = parseInt(month, 10)

    const [{ data: recs }, { data: snaps }, { data: costs }] = await Promise.all([
      supabase.schema('menumaker').from('receipts')
        .select('id,receipt_date,vendor,food_amt,nonfood_amt,milk_whole,milk_skim,milk_pct1,fiscal_month')
        .eq('fiscal_month', fiscalMonth).order('receipt_date'),

      supabase.schema('menumaker').from('inventory_snapshots')
        .select('packages_on_hand,snapshot_date,products(name,package_label,unit_cost,components(slug))')
        .eq('snapshot_date', `${year}-09-30`),

      supabase.schema('menumaker').from('cacfp_form_data')
        .select('form_data')
        .eq('center_id', 'play-academy')
        .eq('form_type', 'other_monthly_costs')
        .eq('fiscal_year', parseInt(year, 10))
        .eq('claim_month', claimMonthInt)
        .maybeSingle(),
    ])

    setReceipts(recs || [])

    const items: SnapItem[] = (snaps || []).map((s: any) => {
      const pkg    = s.packages_on_hand || 0
      const cost   = s.products?.unit_cost || 0
      const slug   = s.products?.components?.slug || ''
      const isFood = !['paper','supply','nonfood'].includes(slug)
      return {
        product_name:    s.products?.name          || '',
        package_label:   s.products?.package_label || null,
        packages_on_hand: pkg,
        unit_cost:       cost,
        total_cost:      pkg * cost,
        is_food:         isFood,
      }
    })
    setSnapItems(items)
    setOtherCosts(costs?.form_data ?? null)
    setLoading(false)
  }, [month, year])

  useEffect(() => { load() }, [load])

  // Build postMessage data for current tab
  const iframeData = useCallback(() => {
    const base = { year, month }
    switch (tab) {
      case 'regular':
        return { ...base, rows: receipts.map(r => ({
          date: r.receipt_date, name: r.vendor,
          food_amount: r.food_amt?.toFixed(2) || '',
          nonfood_amount: r.nonfood_amt?.toFixed(2) || '',
          milk_whole: r.milk_whole || '', milk_skim: r.milk_skim || '', milk_1pct: r.milk_pct1 || '',
        }))}
      case 'beginning':
        return { ...base, month:'10', rows: receipts.map(r => ({
          date: r.receipt_date, name: r.vendor,
          food_amount: r.food_amt?.toFixed(2) || '',
          nonfood_amount: r.nonfood_amt?.toFixed(2) || '',
          milk_whole: r.milk_whole || '', milk_skim: r.milk_skim || '', milk_1pct: r.milk_pct1 || '',
        })), inv_food: snapFood.toFixed(2), inv_nonfood: snapNonFood.toFixed(2) }
      case 'ending':
        return { ...base, month:'09', rows: receipts.map(r => ({
          date: r.receipt_date, name: r.vendor,
          food_amount: r.food_amt?.toFixed(2) || '',
          nonfood_amount: r.nonfood_amt?.toFixed(2) || '',
          milk_whole: r.milk_whole || '', milk_skim: r.milk_skim || '', milk_1pct: r.milk_pct1 || '',
        })), inv_food: snapFood.toFixed(2), inv_nonfood: snapNonFood.toFixed(2) }
      case 'other_costs':
        return { ...base, ...(otherCosts || {}) }
      case 'inv_food':
        return { ...base, rows: snapItems.filter(i => i.is_food).map(i => ({
          item: i.product_name, desc: i.package_label || '',
          qty: String(i.packages_on_hand), cost: i.unit_cost?.toFixed(2) || '',
        }))}
      case 'inv_nonfood':
        return { ...base, rows: snapItems.filter(i => !i.is_food).map(i => ({
          item: i.product_name, desc: i.package_label || '',
          qty: String(i.packages_on_hand), cost: i.unit_cost?.toFixed(2) || '',
        }))}
    }
  }, [tab, receipts, snapItems, otherCosts, snapFood, snapNonFood, year, month])

  const handleCloseMonth = () => {
    const effectiveMonth = tab === 'ending' ? '09' : tab === 'beginning' ? '10' : month
    setCloseMonth(effectiveMonth)
    const found = runValidation({ month: effectiveMonth, year, receipts, snapItems, otherCosts, snapFood, snapNonFood, totalFood, totalNonFood })
    setIssues(found)
    setShowModal(true)
  }

  const handleConfirmClose = async (withWarnings: boolean) => {
    setSaving(true)
    try {
      const claimMonthInt = parseInt(closeMonth, 10)
      const snapshot = {
        center_id: PEARL_CENTER_ID,
        fiscal_year: parseInt(year, 10),
        claim_month: claimMonthInt,
        status: 'closed',
        closed_at: new Date().toISOString(),
        closed_with_warnings: withWarnings,
        warnings: withWarnings ? issues.filter(i => i.level === 'warning').map(i => i.code) : [],
        total_food: totalFood, total_nonfood: totalNonFood,
        total_milk_whole: totalMilkW, total_milk_skim: totalMilkS, total_milk_pct1: totalMilk1,
        receipt_count: receipts.length,
        snap_food: snapFood, snap_nonfood: snapNonFood,
        has_other_costs: !!otherCosts,
      }
      const { error } = await supabase.schema('menumaker').from('monthly_claims')
        .upsert(snapshot, { onConflict: 'center_id,fiscal_year,claim_month' })
      if (error) throw error
      setShowModal(false)
      setCloseStatus({ ok:true, msg:`✓ ${MONTH_LABELS[closeMonth]} ${year} closed successfully${withWarnings?' (with warnings)':''}.` })
    } catch (e: any) {
      setCloseStatus({ ok:false, msg:'✗ Error closing month: ' + e.message })
      setShowModal(false)
    } finally {
      setSaving(false)
    }
  }

  const tabs: [ReportTab, string][] = [
    ['regular',     '📋 Regular (Nov–Aug)'],
    ['beginning',   '📋 Beginning (Oct)'],
    ['ending',      '📋 Ending (Sep)'],
    ['other_costs', '📊 Other Monthly Costs'],
    ['inv_food',    '📦 Inventory Form 1'],
    ['inv_nonfood', '📦 Inventory Form 2'],
  ]

  return (
    <div style={S.page} className="print-page">
      <style>{css}</style>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Serif+Display&display=swap" rel="stylesheet"/>

      {showModal && (
        <CloseMonthModal
          issues={issues} month={closeMonth} year={year}
          onGoToTab={setTab} onConfirm={handleConfirmClose}
          onCancel={() => setShowModal(false)} saving={saving}
        />
      )}

      {/* Toolbar */}
      <div className="no-print">
        {/* Row 1: Title + Close Month */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16, flexWrap:'wrap', gap:12 }}>
          <div>
            <div style={S.title}>CACFP Reports</div>
            <div style={S.sub}>Ohio Child and Adult Care Food Program · Monthly Summary</div>
          </div>
          <button onClick={handleCloseMonth} disabled={loading}
            style={{ padding:'11px 28px', borderRadius:10, border:'none', cursor:loading?'default':'pointer',
              fontSize:14, fontWeight:700, fontFamily:'inherit',
              background:loading?'#ccc':'#1a56a0', color:'#fff', letterSpacing:0.3,
              boxShadow:loading?'none':'0 2px 8px rgba(26,86,160,0.25)', whiteSpace:'nowrap' as const }}>
            📋 Close Month
          </button>
        </div>

        {/* Row 2: Month/Year selectors + Print */}
        <div style={{ display:'flex', gap:12, alignItems:'flex-end', marginBottom:14, flexWrap:'wrap' }}>
          <div>
            <label style={{ fontSize:11, color:'#888', display:'block', marginBottom:3 }}>MONTH</label>
            <select style={S.select} value={month} onChange={e => setMonth(e.target.value)}>
              {['01','02','03','04','05','06','07','08','09','10','11','12'].map((m,i) => (
                <option key={m} value={m}>{MONTHS[i]}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize:11, color:'#888', display:'block', marginBottom:3 }}>YEAR</label>
            <select style={S.select} value={year} onChange={e => setYear(e.target.value)}>
              {['2024','2025','2026','2027'].map(y => <option key={y}>{y}</option>)}
            </select>
          </div>
          <button style={S.printBtn} onClick={() => window.print()}>🖨️ Print / Save PDF</button>
          {loading && <div style={{ fontSize:12, color:'#aaa', alignSelf:'center' }}>Loading…</div>}
        </div>

        {/* Close status banner */}
        {closeStatus && (
          <div style={{ padding:'10px 16px', borderRadius:8, marginBottom:12,
            background:closeStatus.ok?'#e6f4ea':'#fce8e6',
            color:closeStatus.ok?'#1a7a3a':'#b00020',
            fontSize:13, fontWeight:600,
            border:`1px solid ${closeStatus.ok?'#c8e6c9':'#fcc'}`,
            display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span>{closeStatus.msg}</span>
            <button onClick={() => setCloseStatus(null)}
              style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, color:'inherit', lineHeight:1 }}>×</button>
          </div>
        )}

        {/* Summary cards */}
        <div style={{ display:'flex', gap:12, marginBottom:16, flexWrap:'wrap' }}>
          {[
            { n: receipts.length,       l:'receipts',          color: receipts.length>0?'#0a3320':'#c00' },
            { n: fmt$(totalFood),        l:'food total',         color: totalFood>0?'#0a3320':'#888' },
            { n: fmt$(totalNonFood),     l:'non-food total',     color:'#0a3320' },
            { n: fmt$(snapFood),         l:'Sep 30 food inv.',   color: snapFood>0?'#1a56a0':'#888' },
            { n: fmt$(snapNonFood),      l:'Sep 30 non-food inv.',color: snapNonFood>0?'#1a56a0':'#888' },
            { n: otherCosts?'✓':'—',    l:'other costs',        color: otherCosts?'#1a7a3a':'#c00' },
          ].map((s,i) => (
            <div key={i} style={S.statCard}>
              <div style={{ fontSize:18, fontWeight:600, color:s.color }}>{s.n}</div>
              <div style={{ fontSize:11, color:'#888' }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={S.tabs}>
          {tabs.map(([v,l]) => (
            <button key={v} onClick={() => setTab(v)} style={S.tabBtn(tab===v)}>{l}</button>
          ))}
        </div>
      </div>

      {/* iframe — shows actual HTML form */}
      <FormIframe
        key={tab}
        src={TAB_FORM[tab]}
        data={iframeData() || {}}
        onPrint={() => window.print()}
      />
    </div>
  )
}
