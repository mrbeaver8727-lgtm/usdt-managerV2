import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@supabase/supabase-js'

// ============================================================
// Supabase 初始化
// ============================================================
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ============================================================
// 常量
// ============================================================
const UserRole = { ADMIN: 'ADMIN', OPERATOR: 'OPERATOR' }
const TxType = { BUY: 'BUY', SELL: 'SELL' }
const REGISTER_CODE = 'Yzz871127'

// ============================================================
// 工具函数
// ============================================================
const fmt = (val) => new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(val)
const fmtDate = (iso) => new Date(iso).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const getWeekKey = (d) => {
  const date = new Date(d.getTime()); date.setHours(0,0,0,0)
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7))
  const w1 = new Date(date.getFullYear(), 0, 4)
  const wn = 1 + Math.round(((date.getTime() - w1.getTime()) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7)
  return `${date.getFullYear()}-W${String(wn).padStart(2, '0')}`
}
const localISO = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19)
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
const today = () => new Date().toISOString().split('T')[0]

// ============================================================
// 数据库操作
// ============================================================
const db = {
  async getUsers() {
    const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: true })
    if (error) throw error; return data || []
  },
  async registerUser(user) {
    const { data, error } = await supabase.from('users').insert([user]).select().single()
    if (error) throw error; return data
  },
  async loginUser(username, password) {
    const { data, error } = await supabase.from('users').select('*').eq('username', username).eq('password_hash', password).single()
    if (error) return null; return data
  },
  async getTransactions() {
    const { data, error } = await supabase.from('transactions').select('*').order('timestamp', { ascending: false })
    if (error) throw error; return data || []
  },
  async addTransaction(tx) {
    const { data, error } = await supabase.from('transactions').insert([tx]).select().single()
    if (error) throw error; return data
  },
  async updateTransaction(id, updates) {
    const { data, error } = await supabase.from('transactions').update(updates).eq('id', id).select().single()
    if (error) throw error; return data
  },
  async deleteTransaction(id) {
    const { error } = await supabase.from('transactions').delete().eq('id', id)
    if (error) throw error
  },
  async deleteAllTransactions() {
    const { error } = await supabase.from('transactions').delete().neq('id', '')
    if (error) throw error
  },
  subscribeTransactions(cb) {
    const ch = supabase.channel('tx-rt').on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, async () => { cb(await db.getTransactions()) }).subscribe()
    return () => supabase.removeChannel(ch)
  },
  subscribeUsers(cb) {
    const ch = supabase.channel('u-rt').on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, async () => { cb(await db.getUsers()) }).subscribe()
    return () => supabase.removeChannel(ch)
  }
}

// ============================================================
// 小组件
// ============================================================
const Toast = ({ message, type, onClose }) => {
  useEffect(() => { const t = setTimeout(onClose, 2800); return () => clearTimeout(t) }, [onClose])
  const colors = { success: 'from-emerald-500 to-teal-600', error: 'from-red-500 to-rose-600', info: 'from-sky-500 to-blue-600', warning: 'from-amber-500 to-orange-600' }
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' }
  return (
    <div className="fixed top-6 right-6 z-[9999] animate-slide-in">
      <div className={`bg-gradient-to-r ${colors[type] || colors.info} text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 min-w-[260px]`}>
        <span className="text-lg">{icons[type]}</span><span className="text-sm font-medium">{message}</span>
      </div>
    </div>
  )
}

const ConfirmDialog = ({ title, message, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-[9998] flex items-center justify-center" style={{ backdropFilter: 'blur(8px)', background: 'rgba(0,0,0,0.4)' }}>
    <div className="bg-white rounded-3xl p-8 max-w-sm w-full mx-4 shadow-2xl" style={{ animation: 'scaleIn 0.2s ease-out' }}>
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center"><span className="text-3xl">⚠️</span></div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3>
        <p className="text-gray-500 text-sm mb-8">{message}</p>
      </div>
      <div className="flex gap-3">
        <button onClick={onCancel} className="flex-1 py-3 rounded-2xl border-2 border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition-all">取消</button>
        <button onClick={onConfirm} className="flex-1 py-3 rounded-2xl bg-red-500 text-white font-semibold hover:bg-red-600 transition-all shadow-lg shadow-red-200">确认</button>
      </div>
    </div>
  </div>
)

const EyeOpen = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
const EyeClosed = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.59 6.59m7.532 7.532l3.29 3.29M3 3l18 18" /></svg>

// ============================================================
// 登录页面
// ============================================================
const LoginPage = ({ onLogin, onRegister, users, onLoginAttempt }) => {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [regCode, setRegCode] = useState('')
  const [role, setRole] = useState(UserRole.OPERATOR)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPwd, setShowPwd] = useState(false)
  const [showRegCode, setShowRegCode] = useState(false)

  const adminCount = users.filter(u => u.role === UserRole.ADMIN).length
  const opCount = users.filter(u => u.role === UserRole.OPERATOR).length

  const handleSubmit = async () => {
    setError('')
    if (!username.trim() || !password.trim()) { setError('请填写完整信息'); return }
    setLoading(true)
    if (mode === 'register') {
      if (!regCode.trim()) { setError('请输入注册码'); setLoading(false); return }
      if (regCode !== REGISTER_CODE) { setError('注册码错误，请联系管理员获取'); setLoading(false); return }
      try {
        const ok = await onRegister(username.trim(), password, role)
        if (ok) { setMode('login'); setPassword(''); setRegCode(''); setUsername('') }
      } catch (e) { setError(e.message || '注册失败') }
    } else {
      try {
        const ok = await onLoginAttempt(username.trim(), password)
        if (!ok) setError('用户名或密码错误')
      } catch (e) { setError(e.message || '登录失败') }
    }
    setLoading(false)
  }

  const inputStyle = { color: '#ffffff', backgroundColor: 'rgba(255,255,255,0.08)', caretColor: '#38bdf8' }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 40%, #0c4a6e 100%)' }}>
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(14,165,233,0.15) 0%, transparent 70%)' }} />
        <div className="absolute bottom-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.1) 0%, transparent 70%)' }} />
      </div>
      <div className="relative w-full max-w-[420px]">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl mb-5" style={{ background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)', boxShadow: '0 20px 60px rgba(14,165,233,0.3)' }}>
            <span className="text-white text-3xl font-black tracking-tighter">U₮</span>
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">USDT 管理系统</h1>
          <p className="text-sky-300/60 mt-2 text-sm font-medium">进出货 · 财务追踪 · 智能报表</p>
        </div>
        <div className="bg-white/[0.07] backdrop-blur-xl rounded-3xl p-8 border border-white/10" style={{ boxShadow: '0 30px 80px rgba(0,0,0,0.3)' }}>
          <div className="flex bg-white/5 rounded-2xl p-1 mb-8">
            {['login', 'register'].map(k => (
              <button key={k} onClick={() => { setMode(k); setError('') }} className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 ${mode === k ? 'bg-white text-gray-900 shadow-lg' : 'text-white/50 hover:text-white/80'}`}>{k === 'login' ? '登录' : '注册'}</button>
            ))}
          </div>
          <div className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-white/40 uppercase tracking-wider mb-2 ml-1">用户名</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" style={inputStyle}
                className="w-full px-4 py-3.5 border border-white/10 rounded-2xl placeholder-white/25 outline-none focus:border-sky-400/50 transition-all" placeholder="输入用户名" onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
            </div>
            <div>
              <label className="block text-xs font-bold text-white/40 uppercase tracking-wider mb-2 ml-1">密码</label>
              <div className="relative">
                <input type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="off" style={inputStyle}
                  className="w-full px-4 py-3.5 pr-12 border border-white/10 rounded-2xl placeholder-white/25 outline-none focus:border-sky-400/50 transition-all" placeholder="输入密码" onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
                <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-white/30 hover:text-white/70 transition-all rounded-lg">{showPwd ? <EyeOpen /> : <EyeClosed />}</button>
              </div>
            </div>
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-bold text-white/40 uppercase tracking-wider mb-2 ml-1">注册码</label>
                <div className="relative">
                  <input type={showRegCode ? 'text' : 'password'} value={regCode} onChange={e => setRegCode(e.target.value)} autoComplete="off" style={inputStyle}
                    className="w-full px-4 py-3.5 pr-12 border border-white/10 rounded-2xl placeholder-white/25 outline-none focus:border-sky-400/50 transition-all" placeholder="请输入注册码" onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
                  <button type="button" onClick={() => setShowRegCode(!showRegCode)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-white/30 hover:text-white/70 transition-all rounded-lg">{showRegCode ? <EyeOpen /> : <EyeClosed />}</button>
                </div>
              </div>
            )}
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-bold text-white/40 uppercase tracking-wider mb-2 ml-1">账号类型</label>
                <div className="grid grid-cols-2 gap-3">
                  {[{ r: UserRole.OPERATOR, label: '操作员', count: opCount, max: 2 }, { r: UserRole.ADMIN, label: '管理员', count: adminCount, max: 1 }].map(item => {
                    const full = item.count >= item.max
                    return (
                      <button key={item.r} disabled={full} onClick={() => !full && setRole(item.r)}
                        className={`relative py-3 px-4 rounded-2xl border transition-all duration-300 text-sm font-bold ${role === item.r && !full ? 'border-sky-400/60 bg-sky-500/10 text-sky-300' : 'border-white/10 text-white/40'} ${full ? 'opacity-30 cursor-not-allowed' : 'hover:border-white/20 cursor-pointer'}`}>
                        {item.label}<span className="block text-[10px] font-medium mt-0.5 opacity-60">{item.count}/{item.max}{full ? ' 已满' : ''}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            {error && <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-2xl"><span className="text-red-400 text-xs">✕</span><span className="text-red-300 text-sm">{error}</span></div>}
            <button onClick={handleSubmit} disabled={loading} className="w-full py-4 rounded-2xl font-bold text-white transition-all duration-300 disabled:opacity-60" style={{ background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)', boxShadow: '0 10px 40px rgba(14,165,233,0.25)' }}>
              {loading ? <span className="inline-flex items-center gap-2"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full" style={{ animation: 'spin 0.8s linear infinite' }} />处理中...</span> : mode === 'register' ? '立即注册' : '登录系统'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 主应用
// ============================================================
export default function App() {
  const [ready, setReady] = useState(false)
  const [currentUser, setCurrentUser] = useState(() => { try { const s = sessionStorage.getItem('usdt_user'); return s ? JSON.parse(s) : null } catch { return null } })
  const [users, setUsers] = useState([])
  const [transactions, setTransactions] = useState([])
  const [activeTab, setActiveTab] = useState('daily')
  const [selectedDate, setSelectedDate] = useState(today())
  const [toast, setToast] = useState(null)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [syncing, setSyncing] = useState(false)

  // 表单
  const [formData, setFormData] = useState({ price: '', quantity: '', type: TxType.BUY, datetime: localISO(new Date()) })
  const [editingId, setEditingId] = useState(null)

  const showToast = useCallback((message, type = 'info') => setToast({ message, type, key: Date.now() }), [])

  useEffect(() => { if (currentUser) sessionStorage.setItem('usdt_user', JSON.stringify(currentUser)); else sessionStorage.removeItem('usdt_user') }, [currentUser])

  // 初始化
  useEffect(() => {
    let unsub1, unsub2
    ;(async () => {
      try {
        const [u, t] = await Promise.all([db.getUsers(), db.getTransactions()])
        setUsers(u); setTransactions(t)
        unsub1 = db.subscribeTransactions(txs => setTransactions(txs))
        unsub2 = db.subscribeUsers(u => setUsers(u))
      } catch (e) { console.error(e) }
      setReady(true)
    })()
    return () => { if (unsub1) unsub1(); if (unsub2) unsub2() }
  }, [])

  // 同步表单日期
  useEffect(() => {
    if (!editingId) {
      const now = new Date(); const [y, m, d] = selectedDate.split('-').map(Number)
      setFormData(p => ({ ...p, datetime: localISO(new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds())) }))
    }
  }, [selectedDate, editingId])

  const handleRegister = async (username, password, role) => {
    if (users.find(u => u.username === username)) { showToast('该用户名已存在', 'error'); return false }
    if (role === UserRole.ADMIN && users.filter(u => u.role === UserRole.ADMIN).length >= 1) { showToast('系统限制：只能注册一个管理员', 'error'); return false }
    if (role === UserRole.OPERATOR && users.filter(u => u.role === UserRole.OPERATOR).length >= 2) { showToast('系统限制：最多两个操作员', 'error'); return false }
    try { await db.registerUser({ username, password_hash: password, role }); showToast('注册成功，请登录', 'success'); return true }
    catch (e) { showToast('注册失败: ' + (e.message || ''), 'error'); return false }
  }

  const handleLoginAttempt = async (username, password) => {
    const user = await db.loginUser(username, password)
    if (user) { setCurrentUser(user); showToast(`欢迎回来，${user.username}！`, 'success'); return true }
    return false
  }

  // 每日汇总
  const summary = useMemo(() => {
    const sorted = [...transactions].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    let tQty = 0, tCost = 0
    sorted.filter(t => t.date_str < selectedDate).forEach(t => {
      if (t.type === TxType.BUY) { tCost += t.total; tQty += t.quantity }
      else { const avg = tQty > 0 ? tCost / tQty : 0; tQty = Math.max(0, tQty - t.quantity); tCost = tQty * avg }
    })
    const openBal = tQty
    let dayBuyQty = 0, dayBuyAmt = 0, daySellQty = 0, daySellAmt = 0, dayProfit = 0
    const dayTxs = sorted.filter(t => t.date_str === selectedDate)
    dayTxs.forEach(t => {
      if (t.type === TxType.BUY) { dayBuyQty += t.quantity; dayBuyAmt += t.total; tQty += t.quantity; tCost += t.total }
      else { const avg = tQty > 0 ? tCost / tQty : 0; daySellQty += t.quantity; daySellAmt += t.total; dayProfit += (t.price - avg) * t.quantity; tQty = Math.max(0, tQty - t.quantity); tCost = tQty * avg }
    })
    return { openBal, dayBuyQty, dayBuyAmt, daySellQty, daySellAmt, closingBal: tQty, avgCost: tQty > 0 ? tCost / tQty : 0, dayProfit, dayTxs }
  }, [transactions, selectedDate])

  // 周报
  const weeklyData = useMemo(() => {
    const sorted = [...transactions].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    const weeks = new Map(); let cQ = 0, cC = 0
    sorted.forEach(t => {
      const wk = getWeekKey(new Date(t.timestamp))
      if (!weeks.has(wk)) weeks.set(wk, { weekKey: wk, buyQty: 0, buyAmt: 0, sellQty: 0, sellAmt: 0, profit: 0 })
      const w = weeks.get(wk)
      if (t.type === TxType.BUY) { w.buyQty += t.quantity; w.buyAmt += t.total; cQ += t.quantity; cC += t.total }
      else { const avg = cQ > 0 ? cC / cQ : 0; w.sellQty += t.quantity; w.sellAmt += t.total; w.profit += (t.price - avg) * t.quantity; cQ = Math.max(0, cQ - t.quantity); cC = cQ * avg }
    })
    return Array.from(weeks.values()).reverse()
  }, [transactions])

  // 交易操作
  const handleTxSubmit = async () => {
    if (!formData.price || !formData.quantity) { showToast('请填写价格和数量', 'warning'); return }
    const price = parseFloat(formData.price), quantity = parseFloat(formData.quantity)
    if (isNaN(price) || isNaN(quantity) || price <= 0 || quantity <= 0) { showToast('价格和数量必须为正数', 'warning'); return }
    const fullTs = new Date(formData.datetime).toISOString(), datePart = formData.datetime.split('T')[0]
    setSyncing(true)
    try {
      if (editingId) {
        const tx = transactions.find(t => t.id === editingId)
        const ec = currentUser?.role === UserRole.OPERATOR ? (tx?.edit_count || 0) + 1 : (tx?.edit_count || 0)
        await db.updateTransaction(editingId, { price, quantity, total: price * quantity, type: formData.type, timestamp: fullTs, date_str: datePart, edit_count: ec })
        setEditingId(null); showToast('记录已更新', 'success')
      } else {
        await db.addTransaction({ id: genId(), price, quantity, total: price * quantity, type: formData.type, timestamp: fullTs, date_str: datePart, edit_count: 0, operator_name: currentUser?.username || '' })
        showToast(formData.type === TxType.BUY ? '进货记录已添加' : '出货记录已添加', 'success')
      }
    } catch (e) { showToast('操作失败: ' + (e.message || ''), 'error') }
    setFormData(p => ({ ...p, price: '', quantity: '' })); setSyncing(false)
  }

  const handleEdit = (tx) => {
    if (currentUser?.role === UserRole.OPERATOR && tx.edit_count >= 1) { showToast('修改次数已达上限', 'warning'); return }
    setEditingId(tx.id); setFormData({ price: String(tx.price), quantity: String(tx.quantity), type: tx.type, datetime: localISO(new Date(tx.timestamp)) })
    showToast('正在编辑记录', 'info')
  }

  const handleDelete = (tx) => {
    if (currentUser?.role !== UserRole.ADMIN) return
    setConfirmDialog({ title: '删除确认', message: `确定删除这条${tx.type === TxType.BUY ? '进货' : '出货'}记录？`,
      onConfirm: async () => { setSyncing(true); try { await db.deleteTransaction(tx.id); showToast('已删除', 'success') } catch (e) { showToast('删除失败', 'error') } setSyncing(false); setConfirmDialog(null) },
      onCancel: () => setConfirmDialog(null)
    })
  }

  if (!ready) return <div className="min-h-screen flex items-center justify-center" style={{ background: '#0f172a' }}><div className="text-center"><div className="w-12 h-12 mx-auto border-[3px] border-sky-400/30 border-t-sky-400 rounded-full" style={{ animation: 'spin 0.8s linear infinite' }} /><p className="text-sky-300/50 mt-4 text-sm">正在连接服务器...</p></div></div>

  if (!currentUser) return <>
    <LoginPage onLogin={setCurrentUser} onRegister={handleRegister} users={users} onLoginAttempt={handleLoginAttempt} />
    {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
  </>

  const isAdmin = currentUser.role === UserRole.ADMIN
  const previewTotal = formData.price && formData.quantity ? parseFloat(formData.price) * parseFloat(formData.quantity) : null

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {confirmDialog && <ConfirmDialog {...confirmDialog} />}
      <div className="min-h-screen flex flex-col" style={{ background: '#f8fafc' }}>
        {/* 导航 */}
        <header className="bg-white/80 backdrop-blur-xl border-b border-gray-100 sticky top-0 z-50" style={{ boxShadow: '0 1px 20px rgba(0,0,0,0.04)' }}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-sm" style={{ background: 'linear-gradient(135deg, #0ea5e9, #6366f1)' }}>U₮</div>
                <span className="font-extrabold text-lg text-gray-900 tracking-tight hidden sm:block">USDT-Tracker</span>
                {syncing ? <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 bg-sky-50 text-sky-500 rounded-lg text-[10px] font-bold"><span className="w-2 h-2 bg-sky-400 rounded-full" style={{ animation: 'spin 1s linear infinite' }} />同步中</span>
                  : <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-500 rounded-lg text-[10px] font-bold"><span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />已连接</span>}
              </div>
              <nav className="hidden md:flex items-center gap-1">
                {[['daily', '📊 每日记录'], ['weekly', '📈 汇总报表'], ['settings', '⚙️ 设置']].map(([k, l]) => (
                  <button key={k} onClick={() => setActiveTab(k)} className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${activeTab === k ? 'bg-sky-50 text-sky-600' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'}`}>{l}</button>
                ))}
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:block text-right mr-1"><p className="text-[11px] text-gray-400">{isAdmin ? '管理员' : '操作员'}</p><p className="text-sm font-bold text-gray-700">{currentUser.username}</p></div>
              <button onClick={() => setCurrentUser(null)} className="w-9 h-9 rounded-xl bg-gray-50 hover:bg-red-50 text-gray-400 hover:text-red-500 flex items-center justify-center transition-all" title="退出">
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              </button>
            </div>
          </div>
          <nav className="md:hidden flex items-center justify-around border-t border-gray-50 py-1.5 bg-white">
            {[['daily', '📊', '每日'], ['weekly', '📈', '报表'], ['settings', '⚙️', '设置']].map(([k, icon, l]) => (
              <button key={k} onClick={() => setActiveTab(k)} className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-all ${activeTab === k ? 'text-sky-600 bg-sky-50' : 'text-gray-400'}`}><span className="text-base">{icon}</span><span className="text-[10px] font-bold">{l}</span></button>
            ))}
          </nav>
        </header>

        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
          {/* ===== 每日记录 ===== */}
          {activeTab === 'daily' && <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="px-4 py-2.5 bg-white border border-gray-200 rounded-2xl shadow-sm focus:ring-2 focus:ring-sky-200 focus:border-sky-400 outline-none font-semibold text-gray-700 text-sm" />
                <div><h1 className="text-xl font-extrabold text-gray-900">交易流水</h1><p className="text-xs text-gray-400 mt-0.5">结存自动转入次日</p></div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() - 1); setSelectedDate(d.toISOString().split('T')[0]) }} className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-gray-500 hover:bg-gray-50 text-sm font-medium transition-all">← 前一天</button>
                <button onClick={() => setSelectedDate(today())} className="px-3 py-2 bg-sky-50 border border-sky-200 rounded-xl text-sky-600 hover:bg-sky-100 text-sm font-bold transition-all">今天</button>
                <button onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() + 1); setSelectedDate(d.toISOString().split('T')[0]) }} className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-gray-500 hover:bg-gray-50 text-sm font-medium transition-all">后一天 →</button>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {[{ label: '当日进货', value: `${fmt(summary.dayBuyQty)} USDT`, sub: `成本 ¥${fmt(summary.dayBuyAmt)}`, color: 'text-sky-600', icon: '📥' },
                { label: '当日出货', value: `${fmt(summary.daySellQty)} USDT`, sub: `营收 ¥${fmt(summary.daySellAmt)}`, color: 'text-amber-600', icon: '📤' },
                { label: '当日利润', value: `¥${fmt(summary.dayProfit)}`, sub: '基于加权平均成本', color: summary.dayProfit >= 0 ? 'text-emerald-600' : 'text-red-600', icon: summary.dayProfit >= 0 ? '📈' : '📉' },
                { label: '当前仓位', value: `${fmt(summary.closingBal)} USDT`, sub: `均价 ¥${fmt(summary.avgCost)}`, color: 'text-violet-600', icon: '💰', hl: true }
              ].map((c, i) => (
                <div key={i} className={`bg-white p-4 sm:p-5 rounded-2xl border transition-all hover:shadow-md ${c.hl ? 'border-violet-200 ring-2 ring-violet-100' : 'border-gray-100'}`} style={{ animation: `fadeUp 0.4s ease-out ${i * 0.08}s both` }}>
                  <div className="flex items-start justify-between mb-2"><p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">{c.label}</p><span className="text-lg">{c.icon}</span></div>
                  <p className={`text-xl sm:text-2xl font-extrabold leading-tight ${c.color}`}>{c.value}</p>
                  <p className="text-[11px] text-gray-400 mt-1.5">{c.sub}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1">
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm sticky top-28">
                  <h3 className="text-base font-extrabold text-gray-900 mb-5 flex items-center gap-2">
                    <span className="w-1.5 h-5 rounded-full" style={{ background: editingId ? 'linear-gradient(180deg, #f59e0b, #ef4444)' : 'linear-gradient(180deg, #0ea5e9, #6366f1)' }} />
                    {editingId ? '✏️ 编辑记录' : '📝 新增记录'}
                  </h3>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 p-1 bg-gray-50 rounded-2xl">
                      {[{ t: TxType.BUY, l: '📥 进货', g: 'linear-gradient(135deg, #0ea5e9, #0284c7)' }, { t: TxType.SELL, l: '📤 出货', g: 'linear-gradient(135deg, #f59e0b, #d97706)' }].map(b => (
                        <button key={b.t} onClick={() => setFormData(p => ({ ...p, type: b.t }))} className={`py-2.5 rounded-xl text-sm font-bold transition-all duration-300 ${formData.type === b.t ? 'text-white shadow-lg' : 'text-gray-400 hover:text-gray-600'}`} style={formData.type === b.t ? { background: b.g } : {}}>{b.l}</button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="block text-[11px] font-bold text-gray-400 uppercase mb-1.5 ml-1">单价 (¥)</label><input type="number" step="0.0001" value={formData.price} onChange={e => setFormData(p => ({ ...p, price: e.target.value }))} onKeyDown={e => e.key === 'Enter' && handleTxSubmit()} className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-400 text-sm font-medium transition-all" placeholder="7.25" /></div>
                      <div><label className="block text-[11px] font-bold text-gray-400 uppercase mb-1.5 ml-1">数量 (USDT)</label><input type="number" step="0.01" value={formData.quantity} onChange={e => setFormData(p => ({ ...p, quantity: e.target.value }))} onKeyDown={e => e.key === 'Enter' && handleTxSubmit()} className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-400 text-sm font-medium transition-all" placeholder="1000" /></div>
                    </div>
                    {previewTotal !== null && !isNaN(previewTotal) && previewTotal > 0 && <div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-xl border border-dashed border-gray-200"><span className="text-xs text-gray-400 font-medium">预计金额</span><span className="text-base font-extrabold text-gray-700">¥{fmt(previewTotal)}</span></div>}
                    <div><label className="block text-[11px] font-bold text-gray-400 uppercase mb-1.5 ml-1">交易时间</label><input type="datetime-local" step="1" value={formData.datetime} onChange={e => setFormData(p => ({ ...p, datetime: e.target.value }))} className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-400 text-sm font-medium transition-all" /></div>
                    <button onClick={handleTxSubmit} disabled={syncing} className="w-full py-3.5 rounded-2xl font-bold text-white transition-all duration-300 active:scale-[0.97] shadow-lg disabled:opacity-60" style={{ background: editingId ? 'linear-gradient(135deg, #f59e0b, #ef4444)' : 'linear-gradient(135deg, #0ea5e9, #6366f1)' }}>{syncing ? '同步中...' : editingId ? '💾 保存修改' : '✅ 确认录入'}</button>
                    {editingId && <button onClick={() => { setEditingId(null); setFormData(p => ({ ...p, price: '', quantity: '' })) }} className="w-full py-2.5 text-gray-400 hover:text-gray-600 text-sm font-medium transition-all">取消编辑</button>}
                  </div>
                </div>
              </div>

              <div className="lg:col-span-2">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col" style={{ maxHeight: '700px' }}>
                  <div className="p-4 border-b border-gray-50 bg-gray-50/50"><span className="font-bold text-gray-700 text-sm">流水列表 ({summary.dayTxs.length} 条)</span></div>
                  <div className="overflow-y-auto flex-1" style={{ scrollbarWidth: 'thin' }}>
                    {summary.dayTxs.length === 0 ? <div className="flex flex-col items-center justify-center py-20 text-gray-300"><span className="text-5xl mb-4">📋</span><p className="text-sm font-medium">当日暂无交易记录</p></div> : (
                      <table className="w-full text-left">
                        <thead className="bg-gray-50/80 sticky top-0 z-10"><tr>{['类型', '单价', '数量', '总计', '时间', '操作'].map(h => <th key={h} className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">{h}</th>)}</tr></thead>
                        <tbody className="divide-y divide-gray-50">
                          {summary.dayTxs.map((t, i) => (
                            <tr key={t.id} className="hover:bg-sky-50/30 transition-all group" style={{ animation: `fadeUp 0.3s ease-out ${i * 0.04}s both` }}>
                              <td className="px-4 py-3"><span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold ${t.type === TxType.BUY ? 'bg-sky-50 text-sky-600' : 'bg-amber-50 text-amber-600'}`}>{t.type === TxType.BUY ? '📥 进货' : '📤 出货'}</span></td>
                              <td className="px-4 py-3 text-sm font-semibold text-gray-700">¥{t.price}</td>
                              <td className="px-4 py-3 text-sm font-semibold text-gray-700">{fmt(t.quantity)}</td>
                              <td className="px-4 py-3 text-sm text-gray-500 font-medium">¥{fmt(t.total)}</td>
                              <td className="px-4 py-3 text-xs text-gray-400 font-mono">{fmtDate(t.timestamp)}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                  <button onClick={() => handleEdit(t)} disabled={currentUser?.role === UserRole.OPERATOR && t.edit_count >= 1} className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${currentUser?.role === UserRole.OPERATOR && t.edit_count >= 1 ? 'text-gray-200 cursor-not-allowed' : 'text-sky-400 hover:text-sky-600 hover:bg-sky-50'}`}>
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                  </button>
                                  {isAdmin && <button onClick={() => handleDelete(t)} className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                  </button>}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>}

          {/* ===== 周报 ===== */}
          {activeTab === 'weekly' && <div className="space-y-6">
            <div><h1 className="text-2xl font-extrabold text-gray-900">📈 周度财务汇总</h1><p className="text-xs text-gray-400 mt-1">基于加权平均成本算法自动计算利润</p></div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"><div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50/80 border-b border-gray-100"><tr>{['周期', '进货 (USDT)', '进货成本 (¥)', '出货 (USDT)', '出货金额 (¥)', '净利润 (¥)'].map(h => <th key={h} className="px-5 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right first:text-left">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {weeklyData.length === 0 ? <tr><td colSpan={6} className="px-6 py-16 text-center text-gray-300 text-sm italic">暂无汇总数据</td></tr> : weeklyData.map((w, i) => (
                    <tr key={w.weekKey} className="hover:bg-sky-50/20 transition-all" style={{ animation: `fadeUp 0.3s ease-out ${i * 0.05}s both` }}>
                      <td className="px-5 py-4 font-bold text-gray-700 text-sm">{w.weekKey.replace('-W', '年第')}周</td>
                      <td className="px-5 py-4 text-right text-sm text-sky-600 font-semibold">{fmt(w.buyQty)}</td>
                      <td className="px-5 py-4 text-right text-sm text-gray-500">¥{fmt(w.buyAmt)}</td>
                      <td className="px-5 py-4 text-right text-sm text-amber-600 font-semibold">{fmt(w.sellQty)}</td>
                      <td className="px-5 py-4 text-right text-sm text-gray-500">¥{fmt(w.sellAmt)}</td>
                      <td className={`px-5 py-4 text-right text-base font-extrabold ${w.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{w.profit >= 0 ? '+' : ''}¥{fmt(w.profit)}</td>
                    </tr>
                  ))}
                </tbody>
                {weeklyData.length > 0 && <tfoot className="bg-gray-50 font-bold border-t-2 border-gray-200"><tr>
                  <td className="px-5 py-4 text-sm">合计</td>
                  <td className="px-5 py-4 text-right text-sky-700 text-sm">{fmt(weeklyData.reduce((a, w) => a + w.buyQty, 0))}</td>
                  <td className="px-5 py-4 text-right text-sm">¥{fmt(weeklyData.reduce((a, w) => a + w.buyAmt, 0))}</td>
                  <td className="px-5 py-4 text-right text-amber-700 text-sm">{fmt(weeklyData.reduce((a, w) => a + w.sellQty, 0))}</td>
                  <td className="px-5 py-4 text-right text-sm">¥{fmt(weeklyData.reduce((a, w) => a + w.sellAmt, 0))}</td>
                  {(() => { const t = weeklyData.reduce((a, w) => a + w.profit, 0); return <td className={`px-5 py-4 text-right text-lg ${t >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{t >= 0 ? '+' : ''}¥{fmt(t)}</td> })()}
                </tr></tfoot>}
              </table>
            </div></div>
          </div>}

          {/* ===== 设置 ===== */}
          {activeTab === 'settings' && <div className="max-w-2xl mx-auto space-y-6">
            <h1 className="text-2xl font-extrabold text-gray-900">⚙️ 系统设置</h1>
            <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">账户信息</h3>
              <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-2xl">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-black" style={{ background: 'linear-gradient(135deg, #0ea5e9, #6366f1)' }}>{currentUser.username.slice(0, 1).toUpperCase()}</div>
                <div><p className="font-bold text-gray-900 text-lg">{currentUser.username}</p><p className="text-sky-600 text-sm font-semibold">{isAdmin ? '🛡️ 系统管理员' : '👤 操作员'}</p></div>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-4">
                <div className="p-4 bg-sky-50 rounded-2xl text-center"><p className="text-2xl font-extrabold text-sky-600">{transactions.length}</p><p className="text-xs text-sky-500 font-medium mt-1">总交易笔数</p></div>
                <div className="p-4 bg-violet-50 rounded-2xl text-center"><p className="text-2xl font-extrabold text-violet-600">{users.length}</p><p className="text-xs text-violet-500 font-medium mt-1">注册用户</p></div>
                <div className="p-4 bg-emerald-50 rounded-2xl text-center"><p className="text-2xl font-extrabold text-emerald-600">☁️</p><p className="text-xs text-emerald-500 font-medium mt-1">云端同步</p></div>
              </div>
            </div>
            {isAdmin && <div className="bg-white p-6 rounded-2xl border-2 border-red-100 shadow-sm">
              <h3 className="text-sm font-bold text-red-500 uppercase tracking-wider mb-4">⚠️ 危险操作</h3>
              <button onClick={() => setConfirmDialog({ title: '清空数据', message: '确定清空所有交易数据？此操作不可撤销！所有设备数据都会清空！',
                onConfirm: async () => { setSyncing(true); try { await db.deleteAllTransactions(); showToast('已清空', 'success') } catch (e) { showToast('失败', 'error') } setSyncing(false); setConfirmDialog(null) },
                onCancel: () => setConfirmDialog(null) })}
                className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-2xl font-bold transition-all shadow-lg shadow-red-100">🗑️ 重置所有交易数据</button>
            </div>}
          </div>}
        </main>
        <footer className="bg-white border-t border-gray-100 py-4 text-center text-xs text-gray-300 font-medium">USDT 进出货管理系统 © {new Date().getFullYear()} — ☁️ 云端实时同步</footer>
      </div>
    </>
  )
}

