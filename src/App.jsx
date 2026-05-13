import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase'
import { DEFAULT_TABS, DEFAULT_ITEMS, DEFAULT_DEPARTURE, FINAL_CHECKLIST_ITEMS } from './defaultData'

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseTime(str) {
  const [h, m] = str.split(':').map(Number)
  return h * 60 + m
}

function formatTime(minutes) {
  let m = ((minutes % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  const min = m % 60
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(min).padStart(2, '0')} ${ampm}`
}

function calcMilestones(d) {
  const n = k => parseFloat(d[k]) || 0
  const dep = parseTime(d.departureTime)
  const boardingEnd = dep
  const boardingStart = boardingEnd - n('boardingDuration')
  const arriveGate = boardingStart - n('boardingCutoff')
  const leaveBar = arriveGate - n('barToGate')
  const barStart = leaveBar - n('barTime')
  const securityEnd = barStart - n('securityToBar')
  const securityStart = securityEnd - n('securityDuration')
  const bagCheckEnd = securityStart - n('bagCheckToSecurity')
  const bagCheckStart = bagCheckEnd - n('bagCheckDuration')
  const arriveAirport = bagCheckStart - n('parkingToBagCheck')
  const leaveHouse = arriveAirport - n('commuteDuration')
  const wakeUp = leaveHouse - n('wakeToLeave')

  return [
    { key: 'wakeUp',         label: 'wake up',             time: wakeUp,         highlight: true  },
    { key: 'leaveHouse',     label: 'leave house / hotel', time: leaveHouse,     highlight: true  },
    { key: 'arriveAirport',  label: 'arrive at airport',   time: arriveAirport,  highlight: false },
    { key: 'bagCheckStart',  label: 'bag check start',     time: bagCheckStart,  highlight: false },
    { key: 'bagCheckEnd',    label: 'bag check end',       time: bagCheckEnd,    highlight: false },
    { key: 'securityStart',  label: 'security start',      time: securityStart,  highlight: false },
    { key: 'securityEnd',    label: 'security end',        time: securityEnd,    highlight: false },
    { key: 'barStart',       label: 'arrive bar',          time: barStart,       highlight: false },
    { key: 'leaveBar',       label: '⚠ leave bar',          time: leaveBar,       highlight: true  },
    { key: 'arriveGate',     label: 'arrive at gate',      time: arriveGate,     highlight: true  },
    { key: 'boardingStart',  label: 'boarding starts',     time: boardingStart,  highlight: false },
    { key: 'boardingEnd',    label: 'boarding ends',       time: boardingEnd,    highlight: false },
  ]
}

function calcBuffer(wakeUpInput, d) {
  const wakeActual = parseTime(wakeUpInput)
  const dep = parseTime(d.departureTime)
  const boardingStart = dep - d.boardingDuration - d.boardingCutoff
  const n = k => parseFloat(d[k]) || 0
  const arriveGate = wakeActual + n('wakeToLeave') + n('commuteDuration') + n('parkingToBagCheck') + n('bagCheckDuration') + n('bagCheckToSecurity') + n('securityDuration') + n('securityToBar') + n('barTime') + n('barToGate')  const buffer = boardingStart - arriveGate
  return { arriveGate, buffer }
}

// ── Shared UI ─────────────────────────────────────────────────────────────────
function Btn({ children, variant = 'primary', onClick, style = {}, disabled = false }) {
  const variants = {
    primary: { background: 'var(--accent)', color: 'white', border: 'none' },
    outline: { background: 'none', color: 'var(--text-secondary)', border: '1px solid var(--border)' },
    danger:  { background: 'var(--red)', color: 'white', border: 'none' },
    dark:    { background: 'var(--header)', color: 'white', border: 'none' },
  }
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...variants[variant], padding: '8px 18px', borderRadius: 'var(--radius-sm)',
      fontSize: '13px', fontFamily: 'inherit', opacity: disabled ? 0.5 : 1, transition: 'all 0.15s', ...style
    }}>{children}</button>
  )
}

function Card({ children, style = {} }) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: '16px 18px', boxShadow: 'var(--shadow-sm)', ...style
    }}>{children}</div>
  )
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{children}</div>
}

function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--accent)', gap: 12, fontSize: 14 }}>
      <div style={{ width: 18, height: 18, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      Loading...
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ── Checklist Tab ─────────────────────────────────────────────────────────────
function ChecklistTab({ tabId, items, checkedIds, onToggle, onAddItem, onToggleCritical, onAddTag, onRemoveTag, onDeleteItem, onDeleteCategory, tripId }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [criticalOnly, setCriticalOnly] = useState(false)
  const [newItems, setNewItems] = useState({})
  const [newTags, setNewTags] = useState({})
  const [addingTag, setAddingTag] = useState(null)
  const [confirmDeleteCat, setConfirmDeleteCat] = useState(null)

  const tabItems = items.filter(i => i.tab === tabId)
  const categories = [...new Set(tabItems.map(i => i.category))]

  const filtered = (catItems) => catItems.filter(item => {
    const matchSearch = !search || item.name.includes(search.toLowerCase())
    const isChecked = checkedIds.has(item.id)
    const matchFilter = filter === 'all' || (filter === 'unchecked' && !isChecked) || (filter === 'checked' && isChecked)
    const matchCritical = !criticalOnly || item.critical
    return matchSearch && matchFilter && matchCritical
  })

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="search items..." style={{ flex: 1, minWidth: 160 }} />
        {['all', 'unchecked', 'checked'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
            background: filter === f ? 'var(--header)' : 'none',
            color: filter === f ? 'white' : 'var(--text-secondary)',
            fontSize: 12, fontFamily: 'inherit',
          }}>{f}</button>
        ))}
        <button onClick={() => setCriticalOnly(!criticalOnly)} style={{
          padding: '6px 12px', borderRadius: 'var(--radius-sm)',
          border: `1px solid ${criticalOnly ? 'var(--red)' : 'var(--border)'}`,
          background: criticalOnly ? 'var(--red)' : 'none',
          color: criticalOnly ? 'white' : 'var(--red)',
          fontSize: 12, fontFamily: 'inherit',
        }}>★ critical</button>
      </div>

      {categories.map(cat => {
        const catItems = filtered(tabItems.filter(i => i.category === cat))
        const allCatItems = tabItems.filter(i => i.category === cat)
        const checkedCount = allCatItems.filter(i => checkedIds.has(i.id)).length

        return (
          <div key={cat} style={{ marginBottom: 20 }}>
         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{cat}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{checkedCount} / {allCatItems.length}</span>
                {confirmDeleteCat === cat ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => { onDeleteCategory(tabId, cat); setConfirmDeleteCat(null) }} style={{ background: 'var(--red)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 11, padding: '2px 8px', cursor: 'pointer' }}>delete all</button>
                    <button onClick={() => setConfirmDeleteCat(null)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 11, padding: '2px 8px', cursor: 'pointer', color: 'var(--text-muted)' }}>cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmDeleteCat(cat)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 11, padding: '2px 6px', cursor: 'pointer', color: 'var(--red)' }}>✕ category</button>
                )}
              </div>
            </div>

            {catItems.map(item => {
              const isChecked = checkedIds.has(item.id)
              return (
                <div key={item.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                  borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
                  background: isChecked ? 'var(--bg-hover)' : 'var(--bg-card)',
                  marginBottom: 5, opacity: isChecked ? 0.65 : 1,
                }}>
                  {/* Checkbox */}
                  <div onClick={() => onToggle(item.id)} style={{
                    width: 16, height: 16, borderRadius: 4, flexShrink: 0, cursor: 'pointer',
                    border: `1.5px solid ${isChecked ? 'var(--green)' : 'var(--border)'}`,
                    background: isChecked ? 'var(--green)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isChecked && <span style={{ color: 'white', fontSize: 10, lineHeight: 1 }}>✓</span>}
                  </div>

                  {/* Name */}
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', textDecoration: isChecked ? 'line-through' : 'none' }}>{item.name}</span>

              {/* Tags */}
                  {(item.tags || []).map(tag => (
                    <span key={tag} style={{
                      fontSize: 10, padding: '2px 7px', borderRadius: 999,
                      background: 'var(--accent-light)', color: 'var(--accent)',
                      border: '1px solid var(--accent-mid)',
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}>
                      {tag}
                      <span onClick={() => onRemoveTag(item.id, tag)} style={{ cursor: 'pointer', fontSize: 11, lineHeight: 1 }}>×</span>
                    </span>
                  ))}

                  {/* Add tag inline */}
                  {addingTag === item.id ? (
                    <input
                      autoFocus
                      value={newTags[item.id] || ''}
                      onChange={e => setNewTags({ ...newTags, [item.id]: e.target.value })}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && newTags[item.id]?.trim()) {
                          onAddTag(item.id, newTags[item.id].trim().toLowerCase())
                          setNewTags({ ...newTags, [item.id]: '' })
                          setAddingTag(null)
                        }
                        if (e.key === 'Escape') setAddingTag(null)
                      }}
                      placeholder="tag..."
                      style={{ width: 70, padding: '2px 6px', fontSize: 11 }}
                    />
                  ) : (
                    <button onClick={() => setAddingTag(item.id)} style={{
                      background: 'none', border: '1px dashed var(--border)', borderRadius: 999,
                      fontSize: 10, padding: '2px 7px', color: 'var(--text-muted)',
                    }}>+ tag</button>
                  )}

                {/* Critical star */}
                  <span onClick={() => onToggleCritical(item.id, !item.critical)} style={{
                    fontSize: 14, cursor: 'pointer', flexShrink: 0,
                    color: item.critical ? 'var(--red)' : 'var(--border)',
                  }}>★</span>

                  {/* Delete item */}
                  <button onClick={() => onDeleteItem(item.id)} style={{
                    background: 'none', border: 'none', color: 'var(--border)',
                    fontSize: 15, cursor: 'pointer', padding: 0, lineHeight: 1, flexShrink: 0,
                  }} title="delete item">×</button>
                </div>
              )
            })}

            {/* Add item row */}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input
                value={newItems[cat] || ''}
                onChange={e => setNewItems({ ...newItems, [cat]: e.target.value })}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newItems[cat]?.trim()) {
                    onAddItem(tabId, cat, newItems[cat].trim().toLowerCase())
                    setNewItems({ ...newItems, [cat]: '' })
                  }
                }}
                placeholder={`add item to ${cat}...`}
                style={{ flex: 1, border: '1px dashed var(--border)', background: 'var(--bg-subtle)', fontSize: 12 }}
              />
              <button onClick={() => {
                if (newItems[cat]?.trim()) {
                  onAddItem(tabId, cat, newItems[cat].trim().toLowerCase())
                  setNewItems({ ...newItems, [cat]: '' })
                }
              }} style={{
                background: 'var(--accent)', color: 'white', border: 'none',
                borderRadius: 'var(--radius-sm)', padding: '6px 14px', fontSize: 12,
              }}>add</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Departure Tab ─────────────────────────────────────────────────────────────
function DepartureTab({ settings, onSave, items, checkedIds, onToggle, onAddItem, onToggleCritical, onAddTag, onRemoveTag, onDeleteItem, onDeleteCategory, tripId }) {
  const [d, setD] = useState(settings)
  const [wakeInput, setWakeInput] = useState('07:00')
  const [saving, setSaving] = useState(false)

  useEffect(() => { setD(settings) }, [settings])

  const set = k => e => setD({ ...d, [k]: e.target.value })
  const milestones = calcMilestones(d)
  const { arriveGate, buffer } = calcBuffer(wakeInput, d)

  const toggleHide = (key) => {
    const hidden = d.hiddenMilestones || []
    const updated = hidden.includes(key) ? hidden.filter(k => k !== key) : [...hidden, key]
    setD({ ...d, hiddenMilestones: updated })
  }

  const handleSave = async () => {
    setSaving(true)
    await onSave(d)
    setSaving(false)
  }

  const InputRow = ({ label, field, isTime = false }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 8, alignItems: 'center', marginBottom: 8 }}>
      <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</label>
      <input
        type={isTime ? 'time' : 'number'}
        value={d[field]}
        onChange={set(field)}
        style={{ textAlign: 'center', padding: '5px 8px' }}
      />
    </div>
  )

return (
    <div>
      {/* Final checklist — top */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 400, color: 'var(--text-primary)', marginBottom: 4 }}>final checklist</div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>last check before you leave</p>
        <ChecklistTab
          tabId="depart"
          items={items}
          checkedIds={checkedIds}
          onToggle={onToggle}
          onAddItem={onAddItem}
          onToggleCritical={onToggleCritical}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
          onDeleteItem={onDeleteItem}
          onDeleteCategory={onDeleteCategory}
          tripId={tripId}
        />
      </div>

      {/* Flight inputs */}
      <Card style={{ marginBottom: 16 }}>
        <SectionLabel>flight inputs</SectionLabel>
        <InputRow label="departure time" field="departureTime" isTime />
        <InputRow label="boarding cutoff (min)" field="boardingCutoff" />
        <InputRow label="boarding duration (min)" field="boardingDuration" />
        <InputRow label="bar to gate (min)" field="barToGate" />
        <InputRow label="bar duration (min)" field="barTime" />
        <InputRow label="security to bar (min)" field="securityToBar" />
        <InputRow label="security duration (min)" field="securityDuration" />
        <InputRow label="bag check to security (min)" field="bagCheckToSecurity" />
        <InputRow label="bag check duration (min)" field="bagCheckDuration" />
        <InputRow label="parking to bag check (min)" field="parkingToBagCheck" />
        <InputRow label="commute to airport (min)" field="commuteDuration" />
        <InputRow label="wake up to leave (min)" field="wakeToLeave" />
        <div style={{ marginTop: 12 }}>
          <Btn onClick={handleSave} disabled={saving} style={{ width: '100%' }}>{saving ? 'Saving...' : 'Save settings'}</Btn>
        </div>
      </Card>

      {/* Milestones — below inputs */}
      <Card style={{ marginBottom: 16 }}>
        <SectionLabel>calculated milestones</SectionLabel>
        {milestones.map(m => {
          const isHidden = (d.hiddenMilestones || []).includes(m.key)
          return (
            <div key={m.key} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 0', borderBottom: '1px solid var(--border-light)',
            }}>
              <span style={{ fontSize: 12, color: m.highlight ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: m.highlight ? 700 : 400 }}>
                {m.label}
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={() => toggleHide(m.key)} style={{
                  background: 'none', border: 'none', fontSize: 10,
                  color: 'var(--text-muted)', padding: 0, cursor: 'pointer',
                }}>{isHidden ? 'show' : 'hide'}</button>
                {!isHidden && (
                  <span style={{ fontSize: 13, fontWeight: 700, color: m.highlight ? 'var(--accent)' : 'var(--green)', minWidth: 70, textAlign: 'right' }}>
                    {formatTime(m.time)}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </Card>

      {/* Buffer calculator */}
      <Card>
        <SectionLabel>wake up → buffer calculator</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 8, alignItems: 'center', marginBottom: 14, maxWidth: 280 }}>
          <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>if i wake up at...</label>
          <input type="time" value={wakeInput} onChange={e => setWakeInput(e.target.value)} style={{ textAlign: 'center', padding: '5px 8px' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ background: 'var(--bg-hover)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Playfair Display', serif" }}>{formatTime(arriveGate)}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>arrive at gate</div>
          </div>
          <div style={{ background: 'var(--bg-hover)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Playfair Display', serif", color: buffer >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {buffer >= 0 ? `+${buffer} min` : `${buffer} min`}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{buffer >= 0 ? 'buffer before boarding' : 'you will miss boarding'}</div>
          </div>
        </div>
      </Card>
    </div>
  )
}

// ── App Root ──────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState('gear')
  const [tabs, setTabs] = useState(DEFAULT_TABS)
  const [items, setItems] = useState([])
  const [checkedIds, setCheckedIds] = useState(new Set())
  const [tripId, setTripId] = useState(null)
  const [departure, setDeparture] = useState(DEFAULT_DEPARTURE)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)
  const [showNewTrip, setShowNewTrip] = useState(false)
  const [editingTab, setEditingTab] = useState(null)
  const [editTabLabel, setEditTabLabel] = useState('')

  // ── Load ──────────────────────────────────────────────────────────────────
useEffect(() => {
    (async () => {
      try {
        // Load or seed items
        const { data: existingItems } = await supabase.from('items').select('*').order('sort_order')
        if (existingItems && existingItems.length > 0) {
          const hasFinalChecklist = existingItems.some(i => i.tab === 'depart')
          if (!hasFinalChecklist) {
            const toInsert = FINAL_CHECKLIST_ITEMS.map((item, i) => ({ ...item, sort_order: i }))
            const { data: inserted } = await supabase.from('items').insert(toInsert).select()
            if (inserted) setItems([...existingItems, ...inserted])
            else setItems(existingItems)
          } else {
            setItems(existingItems)
          }
        } else if (existingItems && existingItems.length === 0) {
          const allItems = [...DEFAULT_ITEMS, ...FINAL_CHECKLIST_ITEMS]
          const toInsert = allItems.map((item, i) => ({ ...item, sort_order: i }))
          const { data: inserted } = await supabase.from('items').insert(toInsert).select()
          if (inserted) setItems(inserted)
        }

        // Load or create active trip
        const { data: trips } = await supabase.from('trips').select('*').order('started_at', { ascending: false }).limit(1)
        let activeTrip = trips?.[0]
        if (!activeTrip) {
          const { data: newTrip } = await supabase.from('trips').insert([{ name: 'trip 1' }]).select()
          activeTrip = newTrip?.[0]
        }
        if (activeTrip) {
          setTripId(activeTrip.id)
          const { data: checked } = await supabase.from('checked_items').select('item_id').eq('trip_id', activeTrip.id)
          if (checked) setCheckedIds(new Set(checked.map(c => c.item_id)))
        }

        // Load departure settings
        const { data: depData } = await supabase.from('departure_settings').select('*').limit(1)
        if (depData && depData.length > 0) setDeparture(depData[0].data)

        // Load app settings (tab labels)
        const { data: appData } = await supabase.from('app_settings').select('*').limit(1)
        if (appData && appData.length > 0 && appData[0].data?.tabs) setTabs(appData[0].data.tabs)

      } catch (e) {
        console.error(e)
        setError('Could not connect to database.')
      }
      setLoaded(true)
    })()
  }, [])

  // ── Toggle checked ────────────────────────────────────────────────────────
  const toggleItem = useCallback(async (itemId) => {
    if (!tripId) return
    const isChecked = checkedIds.has(itemId)
    const newSet = new Set(checkedIds)
    if (isChecked) {
      newSet.delete(itemId)
      await supabase.from('checked_items').delete().eq('trip_id', tripId).eq('item_id', itemId)
    } else {
      newSet.add(itemId)
      await supabase.from('checked_items').insert([{ trip_id: tripId, item_id: itemId }])
    }
    setCheckedIds(newSet)
  }, [checkedIds, tripId])

  // ── Add item ──────────────────────────────────────────────────────────────
  const addItem = useCallback(async (tabId, category, name) => {
    const { data } = await supabase.from('items').insert([{ tab: tabId, category, name, critical: false, tags: [], sort_order: items.length }]).select()
    if (data) setItems(prev => [...prev, data[0]])
  }, [items])

  // ── Toggle critical ───────────────────────────────────────────────────────
  const toggleCritical = useCallback(async (itemId, critical) => {
    await supabase.from('items').update({ critical }).eq('id', itemId)
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, critical } : i))
  }, [])

  // ── Add tag ───────────────────────────────────────────────────────────────
  const addTag = useCallback(async (itemId, tag) => {
    const item = items.find(i => i.id === itemId)
    if (!item) return
    const tags = [...(item.tags || []), tag]
    await supabase.from('items').update({ tags }).eq('id', itemId)
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, tags } : i))
  }, [items])

  const deleteItem = useCallback(async (itemId) => {
    await supabase.from('checked_items').delete().eq('item_id', itemId)
    await supabase.from('items').delete().eq('id', itemId)
    setItems(prev => prev.filter(i => i.id !== itemId))
    setCheckedIds(prev => { const s = new Set(prev); s.delete(itemId); return s })
  }, [])
const removeTag = useCallback(async (itemId, tag) => {
    const item = items.find(i => i.id === itemId)
    if (!item) return
    const tags = (item.tags || []).filter(t => t !== tag)
    await supabase.from('items').update({ tags }).eq('id', itemId)
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, tags } : i))
  }, [items])
  const deleteCategory = useCallback(async (tabId, category) => {
    const toDelete = items.filter(i => i.tab === tabId && i.category === category)
    for (const item of toDelete) {
      await supabase.from('checked_items').delete().eq('item_id', item.id)
    }
    const ids = toDelete.map(i => i.id)
    await supabase.from('items').delete().in('id', ids)
    setItems(prev => prev.filter(i => !(i.tab === tabId && i.category === category)))
    setCheckedIds(prev => { const s = new Set(prev); ids.forEach(id => s.delete(id)); return s })
  }, [items])

  // ── Start new trip ────────────────────────────────────────────────────────
  const startNewTrip = async () => {
    const { data } = await supabase.from('trips').insert([{ name: `trip ${Date.now()}` }]).select()
    if (data?.[0]) {
      setTripId(data[0].id)
      setCheckedIds(new Set())
    }
    setShowNewTrip(false)
  }

  // ── Save departure ────────────────────────────────────────────────────────
  const saveDeparture = async (d) => {
    await supabase.from('departure_settings').upsert({ id: 1, data: d }, { onConflict: 'id' })
    setDeparture(d)
  }

  // ── Save tab label ────────────────────────────────────────────────────────
  const saveTabLabel = async (tabId, label) => {
    const updated = tabs.map(t => t.id === tabId ? { ...t, label } : t)
    setTabs(updated)
    setEditingTab(null)
    await supabase.from('app_settings').upsert({ id: 1, data: { tabs: updated } }, { onConflict: 'id' })
  }

  if (!loaded) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <Spinner />
    </div>
  )

  const checkedInTab = (tabId) => {
    const tabItems = items.filter(i => i.tab === tabId)
    return tabItems.filter(i => checkedIds.has(i.id)).length
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ background: 'var(--header)', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 2px 12px rgba(0,0,0,0.3)' }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--accent-mid)', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 2 }}>My</div>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, color: '#FDF8F2', fontWeight: 400 }}>Travel Kit</h1>
        </div>
        <button onClick={() => setShowNewTrip(true)} style={{
          background: 'var(--accent)', color: 'white', border: 'none',
          borderRadius: 'var(--radius-sm)', padding: '7px 16px', fontSize: 12, fontFamily: 'inherit',
        }}>start new trip</button>
      </div>

      {/* New trip confirmation */}
      {showNewTrip && (
        <div style={{ background: 'var(--accent-light)', borderBottom: `1px solid var(--accent-mid)`, padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ fontSize: 13, color: 'var(--accent)' }}>start a new trip? all checkmarks will be cleared — your lists stay intact.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="outline" onClick={() => setShowNewTrip(false)} style={{ fontSize: 12, padding: '5px 12px' }}>cancel</Btn>
            <Btn onClick={startNewTrip} style={{ fontSize: 12, padding: '5px 12px' }}>confirm</Btn>
          </div>
        </div>
      )}

      {error && (
        <div style={{ background: 'var(--red-bg)', borderBottom: '1px solid var(--red)', padding: '10px 24px' }}>
          <p style={{ fontSize: 13, color: 'var(--red)' }}>⚠ {error}</p>
        </div>
      )}

      {/* Main tabs */}
      <div style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
        <div style={{ display: 'flex', gap: 2, padding: '8px 16px', minWidth: 'max-content' }}>
          {tabs.map(t => (
            <div key={t.id} style={{ position: 'relative' }}>
              {editingTab === t.id ? (
                <input
                  autoFocus
                  value={editTabLabel}
                  onChange={e => setEditTabLabel(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveTabLabel(t.id, editTabLabel.trim().toLowerCase() || t.label)
                    if (e.key === 'Escape') setEditingTab(null)
                  }}
                  onBlur={() => saveTabLabel(t.id, editTabLabel.trim().toLowerCase() || t.label)}
                  style={{ padding: '6px 12px', fontSize: 12, width: 130 }}
                />
              ) : (
                <button
                  onClick={() => setTab(t.id)}
                  onDoubleClick={() => { setEditingTab(t.id); setEditTabLabel(t.label) }}
                  style={{
                    padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: 'none',
                    background: tab === t.id ? 'var(--header)' : 'none',
                    color: tab === t.id ? 'white' : 'var(--text-secondary)',
                    fontSize: 12, fontFamily: 'inherit', whiteSpace: 'nowrap',
                  }}
                >
                  {t.label}
                  {t.id !== 'depart' && (
                    <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.7 }}>
                      {checkedInTab(t.id)}/{items.filter(i => i.tab === t.id).length}
                    </span>
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
        <div style={{ padding: '0 24px 6px', fontSize: 10, color: 'var(--text-muted)' }}>double-click a tab to rename it</div>
      </div>

      {/* Content */}
      <div style={{ padding: '20px 24px', maxWidth: 900, margin: '0 auto' }}>
        {tab !== 'depart' ? (
         <ChecklistTab
            tabId={tab}
            items={items}
            checkedIds={checkedIds}
            onToggle={toggleItem}
            onAddItem={addItem}
            onToggleCritical={toggleCritical}
            onAddTag={addTag}
         onDeleteItem={deleteItem}
            onDeleteCategory={deleteCategory}
            onRemoveTag={removeTag}
            tripId={tripId}
          />
        ) : (
          <DepartureTab
          settings={departure}
          onSave={saveDeparture}
          items={items}
          checkedIds={checkedIds}
          onToggle={toggleItem}
          onAddItem={addItem}
          onToggleCritical={toggleCritical}
          onAddTag={addTag}
          onRemoveTag={removeTag}
          onDeleteItem={deleteItem}
          onDeleteCategory={deleteCategory}
          tripId={tripId}
        />
        )}
      </div>
    </div>
  )
}
