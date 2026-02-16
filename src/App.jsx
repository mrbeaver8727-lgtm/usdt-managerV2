import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

// ============================================================
// Supabase
// ============================================================
const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
const UserRole = { ADMIN: 'ADMIN', OPERATOR: 'OPERATOR' }
const TxType = { BUY: 'BUY', SELL: 'SELL' }
const REGISTER_CODE = 'Yzz871127'
const MAX_ATTACHMENTS = 10
const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB

// ============================================================
// 工具函数
// ============================================================
const fmt = (v) => new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v)
const fmtDate = (iso) => new Date(iso).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const getWeekKey = (d) => { const dt = new Date(d.getTime()); dt.setHours(0,0,0,0); dt.setDate(dt.getDate()+3-((dt.getDay()+6)%7)); const w1=new Date(dt.getFullYear(),0,4); const wn=1+Math.round(((dt.getTime()-w1.getTime())/864e5-3+((w1.getDay()+6)%7))/7); return `${dt.getFullYear()}-W${String(wn).padStart(2,'0')}` }
const localISO = (d) => new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,19)
const genId = () => Date.now().toString(36)+Math.random().toString(36).slice(2,7)
const today = () => new Date().toISOString().split('T')[0]
const getFileType = (name) => { const ext = name.split('.').pop().toLowerCase(); if (['jpg','jpeg','png','gif','webp','heic','heif','bmp'].includes(ext)) return 'image'; if (['mp4','mov','avi','mkv','webm','3gp','m4v'].includes(ext)) return 'video'; if (['mp3','wav','m4a','aac','ogg','amr','flac','wma'].includes(ext)) return 'audio'; return 'other' }
const fmtSize = (bytes) => { if (bytes < 1024) return bytes + ' B'; if (bytes < 1048576) return (bytes/1024).toFixed(1) + ' KB'; return (bytes/1048576).toFixed(1) + ' MB' }

// ============================================================
// 数据库操作
// ============================================================
const db = {
  // 用户
  async getUsers() { const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: true }); if (error) throw error; return data || [] },
  async registerUser(u) { const { data, error } = await supabase.from('users').insert([u]).select().single(); if (error) throw error; return data },
  async loginUser(un, pw) { const { data } = await supabase.from('users').select('*').eq('username', un).eq('password_hash', pw).single(); return data },

  // 交易簿
  async getLedgers() { const { data, error } = await supabase.from('ledgers').select('*').order('created_at', { ascending: false }); if (error) throw error; return data || [] },
  async createLedger(l) { const { data, error } = await supabase.from('ledgers').insert([l]).select().single(); if (error) throw error; return data },
  async deleteLedger(id) { await supabase.from('transactions').delete().eq('ledger_id', id); await supabase.from('attachments').delete().eq('ledger_id', id); const { error } = await supabase.from('ledgers').delete().eq('id', id); if (error) throw error },

  // 交易
  async getTransactions(ledgerId) { const { data, error } = await supabase.from('transactions').select('*').eq('ledger_id', ledgerId).order('timestamp', { ascending: false }); if (error) throw error; return data || [] },
  async addTransaction(tx) { const { data, error } = await supabase.from('transactions').insert([tx]).select().single(); if (error) throw error; return data },
  async updateTransaction(id, u) { const { data, error } = await supabase.from('transactions').update(u).eq('id', id).select().single(); if (error) throw error; return data },
  async deleteTransaction(id) { await supabase.from('attachments').delete().eq('transaction_id', id); const { error } = await supabase.from('transactions').delete().eq('id', id); if (error) throw error },
  async deleteAllTransactions(ledgerId) { await supabase.from('attachments').delete().eq('ledger_id', ledgerId); const { error } = await supabase.from('transactions').delete().eq('ledger_id', ledgerId); if (error) throw error },

  // 附件
  async getAttachments(txId) { const { data, error } = await supabase.from('attachments').select('*').eq('transaction_id', txId).order('created_at', { ascending: true }); if (error) throw error; return data || [] },
  async getAllAttachments(ledgerId) { const { data, error } = await supabase.from('attachments').select('*').eq('ledger_id', ledgerId).order('created_at', { ascending: true }); if (error) throw error; return data || [] },
  async addAttachment(a) { const { data, error } = await supabase.from('attachments').insert([a]).select().single(); if (error) throw error; return data },
  async deleteAttachment(att) {
    await supabase.storage.from('evidence').remove([att.storage_path])
    const { error } = await supabase.from('attachments').delete().eq('id', att.id); if (error) throw error
  },

  // 文件上传
  async uploadFile(file, txId, ledgerId) {
    const ext = file.name.split('.').pop()
    const path = `${ledgerId}/${txId}/${genId()}.${ext}`
    const { error } = await supabase.storage.from('evidence').upload(path, file, { cacheControl: '3600', upsert: false })
    if (error) throw error
    const { data: urlData } = supabase.storage.from('evidence').getPublicUrl(path)
    return { storage_path: path, public_url: urlData.publicUrl, file_name: file.name, file_size: file.size, file_type: getFileType(file.name) }
  },

  // 实时订阅
  subscribeTx(ledgerId, cb) {
    const ch = supabase.channel(`tx-${ledgerId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `ledger_id=eq.${ledgerId}` }, () => db.getTransactions(ledgerId).then(cb)).subscribe()
    return () => supabase.removeChannel(ch)
  },
  subscribeUsers(cb) {
    const ch = supabase.channel('u-rt').on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => db.getUsers().then(cb)).subscribe()
    return () => supabase.removeChannel(ch)
  },
  subscribeLedgers(cb) {
    const ch = supabase.channel('l-rt').on('postgres_changes', { event: '*', schema: 'public', table: 'ledgers' }, () => db.getLedgers().then(cb)).subscribe()
    return () => supabase.removeChannel(ch)
  }
}

// ============================================================
// 小组件
// ============================================================
const Toast = ({ message, type, onClose }) => {
  useEffect(() => { const t = setTimeout(onClose, 2800); return () => clearTimeout(t) }, [onClose])
  const c = { success: 'from-emerald-500 to-teal-600', error: 'from-red-500 to-rose-600', info: 'from-sky-500 to-blue-600', warning: 'from-amber-500 to-orange-600' }
  const ic = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' }
  return <div className="fixed top-6 right-6 z-[9999] animate-slide-in"><div className={`bg-gradient-to-r ${c[type]||c.info} text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 min-w-[260px]`}><span className="text-lg">{ic[type]}</span><span className="text-sm font-medium">{message}</span></div></div>
}

const ConfirmDialog = ({ title, message, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-[9998] flex items-center justify-center" style={{ backdropFilter: 'blur(8px)', background: 'rgba(0,0,0,0.4)' }}>
    <div className="bg-white rounded-3xl p-8 max-w-sm w-full mx-4 shadow-2xl" style={{ animation: 'scaleIn 0.2s ease-out' }}>
      <div className="text-center"><div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center"><span className="text-3xl">⚠️</span></div><h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3><p className="text-gray-500 text-sm mb-8">{message}</p></div>
      <div className="flex gap-3"><button onClick={onCancel} className="flex-1 py-3 rounded-2xl border-2 border-gray-200 text-gray-600 font-semibold hover:bg-gray-50">取消</button><button onClick={onConfirm} className="flex-1 py-3 rounded-2xl bg-red-500 text-white font-semibold hover:bg-red-600 shadow-lg shadow-red-200">确认</button></div>
    </div>
  </div>
)

const EyeOpen = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
const EyeClosed = () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.59 6.59m7.532 7.532l3.29 3.29M3 3l18 18" /></svg>

// ============================================================
// 附件预览弹窗
// ============================================================
const AttachmentViewer = ({ attachments, initialIndex, onClose }) => {
  const [idx, setIdx] = useState(initialIndex || 0)
  const att = attachments[idx]
  if (!att) return null
  return (
    <div className="fixed inset-0 z-[9997] flex items-center justify-center" style={{ backdropFilter: 'blur(12px)', background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div className="relative max-w-4xl w-full max-h-[90vh] mx-4" onClick={e => e.stopPropagation()}>
        <div className="absolute top-2 right-2 z-10 flex gap-2">
          <a href={att.public_url} download={att.file_name} target="_blank" rel="noreferrer" className="w-10 h-10 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-all" title="下载">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
          </a>
          <button onClick={onClose} className="w-10 h-10 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-all">✕</button>
        </div>
        {attachments.length > 1 && <>
          <button onClick={() => setIdx(i => (i - 1 + attachments.length) % attachments.length)} className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center text-white text-xl">‹</button>
          <button onClick={() => setIdx(i => (i + 1) % attachments.length)} className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-xl bg-white/20 hover:bg-white/30 flex items-center justify-center text-white text-xl">›</button>
        </>}
        <div className="flex items-center justify-center min-h-[60vh]">
          {att.file_type === 'image' && <img src={att.public_url} alt={att.file_name} className="max-w-full max-h-[80vh] rounded-2xl object-contain" />}
          {att.file_type === 'video' && <video src={att.public_url} controls className="max-w-full max-h-[80vh] rounded-2xl" />}
          {att.file_type === 'audio' && <div className="bg-white/10 rounded-3xl p-8 text-center"><div className="text-6xl mb-4">🎵</div><p className="text-white/80 text-sm mb-4">{att.file_name}</p><audio src={att.public_url} controls className="w-full" /></div>}
          {att.file_type === 'other' && <div className="bg-white/10 rounded-3xl p-8 text-center"><div className="text-6xl mb-4">📄</div><p className="text-white/80 text-sm">{att.file_name}</p><p className="text-white/50 text-xs mt-2">{fmtSize(att.file_size)}</p></div>}
        </div>
        <div className="text-center mt-3 text-white/60 text-xs">{idx + 1} / {attachments.length} · {att.file_name}</div>
      </div>
    </div>
  )
}

// ============================================================
// 附件上传与展示组件
// ============================================================
const AttachmentPanel = ({ txId, ledgerId, attachments, setAttachments, showToast, readOnly }) => {
  const [uploading, setUploading] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(null)
  const fileRef = useRef(null)

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    if (attachments.length + files.length > MAX_ATTACHMENTS) { showToast(`每条记录最多${MAX_ATTACHMENTS}个附件`, 'warning'); return }
    for (const f of files) { if (f.size > MAX_FILE_SIZE) { showToast(`${f.name} 超过200MB限制`, 'error'); return } }
    setUploading(true)
    try {
      for (const file of files) {
        const info = await db.uploadFile(file, txId, ledgerId)
        const att = await db.addAttachment({ id: genId(), transaction_id: txId, ledger_id: ledgerId, ...info, created_at: new Date().toISOString() })
        setAttachments(prev => [...prev, att])
      }
      showToast(`${files.length}个文件已上传`, 'success')
    } catch (e) { showToast('上传失败: ' + (e.message || ''), 'error') }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleDelete = async (att) => {
    try { await db.deleteAttachment(att); setAttachments(prev => prev.filter(a => a.id !== att.id)); showToast('已删除', 'success') }
    catch (e) { showToast('删除失败', 'error') }
  }

  const typeIcon = { image: '🖼️', video: '🎬', audio: '🎵', other: '📄' }

  return (
    <div className="mt-3">
      {viewerOpen !== null && <AttachmentViewer attachments={attachments} initialIndex={viewerOpen} onClose={() => setViewerOpen(null)} />}
      {/* 附件列表 */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((att, i) => (
            <div key={att.id} className="relative group">
              <button onClick={() => setViewerOpen(i)} className="w-16 h-16 rounded-xl border border-gray-200 overflow-hidden flex items-center justify-center bg-gray-50 hover:border-sky-300 transition-all" title={att.file_name}>
                {att.file_type === 'image' ? <img src={att.public_url} alt="" className="w-full h-full object-cover" /> : <span className="text-2xl">{typeIcon[att.file_type] || '📄'}</span>}
              </button>
              {!readOnly && <button onClick={() => handleDelete(att)} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow">✕</button>}
            </div>
          ))}
        </div>
      )}
      {/* 上传按钮 */}
      {!readOnly && attachments.length < MAX_ATTACHMENTS && (
        <div>
          <input ref={fileRef} type="file" multiple accept="image/*,video/*,audio/*,.mp4,.mov,.avi,.mp3,.wav,.m4a,.aac,.amr,.3gp,.m4v,.webm" onChange={handleUpload} className="hidden" />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 border border-dashed border-gray-300 rounded-xl text-xs text-gray-500 hover:text-gray-700 transition-all disabled:opacity-50">
            {uploading ? <><span className="w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full" style={{ animation: 'spin 0.8s linear infinite' }} />上传中...</>
              : <>📎 上传存证 ({attachments.length}/{MAX_ATTACHMENTS})</>}
          </button>
        </div>
      )}
    </div>
  )
}

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
      if (regCode !== REGISTER_CODE) { setError('注册码错误'); setLoading(false); return }
      try { const ok = await onRegister(username.trim(), password, role); if (ok) { setMode('login'); setPassword(''); setRegCode(''); setUsername('') } } catch (e) { setError(e.message || '注册失败') }
    } else {
      try { const ok = await onLoginAttempt(username.trim(), password); if (!ok) setError('用户名或密码错误') } catch (e) { setError(e.message || '登录失败') }
    }
    setLoading(false)
  }

  const iStyle = { color: '#fff', backgroundColor: 'rgba(255,255,255,0.08)', caretColor: '#38bdf8' }
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 40%, #0c4a6e 100%)' }}>
      <div className="fixed inset-0 overflow-hidden pointer-events-none"><div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(14,165,233,0.15) 0%, transparent 70%)' }} /><div className="absolute bottom-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.1) 0%, transparent 70%)' }} /></div>
      <div className="relative w-full max-w-[420px]">
        <div className="text-center mb-10"><div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl mb-5" style={{ background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)', boxShadow: '0 20px 60px rgba(14,165,233,0.3)' }}><span className="text-white text-3xl font-black">U₮</span></div><h1 className="text-3xl font-black text-white">USDT 管理系统</h1><p className="text-sky-300/60 mt-2 text-sm font-medium">进出货 · 财务追踪 · 智能报表</p></div>
        <div className="bg-white/[0.07] backdrop-blur-xl rounded-3xl p-8 border border-white/10" style={{ boxShadow: '0 30px 80px rgba(0,0,0,0.3)' }}>
          <div className="flex bg-white/5 rounded-2xl p-1 mb-8">{['login','register'].map(k => <button key={k} onClick={() => { setMode(k); setError('') }} className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${mode===k?'bg-white text-gray-900 shadow-lg':'text-white/50 hover:text-white/80'}`}>{k==='login'?'登录':'注册'}</button>)}</div>
          <div className="space-y-5">
            <div><label className="block text-xs font-bold text-white/40 uppercase tracking-wider mb-2 ml-1">用户名</label><input type="text" value={username} onChange={e=>setUsername(e.target.value)} style={iStyle} className="w-full px-4 py-3.5 border border-white/10 rounded-2xl placeholder-white/25 outline-none focus:border-sky-400/50" placeholder="输入用户名" onKeyDown={e=>e.key==='Enter'&&handleSubmit()} /></div>
            <div><label className="block text-xs font-bold text-white/40 uppercase tracking-wider mb-2 ml-1">密码</label><div className="relative"><input type={showPwd?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} style={iStyle} className="w-full px-4 py-3.5 pr-12 border border-white/10 rounded-2xl placeholder-white/25 outline-none focus:border-sky-400/50" placeholder="输入密码" onKeyDown={e=>e.key==='Enter'&&handleSubmit()} /><button type="button" onClick={()=>setShowPwd(!showPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-white/30 hover:text-white/70 rounded-lg">{showPwd?<EyeOpen/>:<EyeClosed/>}</button></div></div>
            {mode==='register' && <div><label className="block text-xs font-bold text-white/40 uppercase tracking-wider mb-2 ml-1">注册码</label><div className="relative"><input type={showRegCode?'text':'password'} value={regCode} onChange={e=>setRegCode(e.target.value)} style={iStyle} className="w-full px-4 py-3.5 pr-12 border border-white/10 rounded-2xl placeholder-white/25 outline-none focus:border-sky-400/50" placeholder="请输入注册码" onKeyDown={e=>e.key==='Enter'&&handleSubmit()} /><button type="button" onClick={()=>setShowRegCode(!showRegCode)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-white/30 hover:text-white/70 rounded-lg">{showRegCode?<EyeOpen/>:<EyeClosed/>}</button></div></div>}
            {mode==='register' && <div><label className="block text-xs font-bold text-white/40 uppercase tracking-wider mb-2 ml-1">账号类型</label><div className="grid grid-cols-2 gap-3">{[{r:UserRole.OPERATOR,l:'操作员',c:opCount,m:2},{r:UserRole.ADMIN,l:'管理员',c:adminCount,m:1}].map(it=>{const full=it.c>=it.m;return <button key={it.r} disabled={full} onClick={()=>!full&&setRole(it.r)} className={`py-3 px-4 rounded-2xl border text-sm font-bold transition-all ${role===it.r&&!full?'border-sky-400/60 bg-sky-500/10 text-sky-300':'border-white/10 text-white/40'} ${full?'opacity-30 cursor-not-allowed':'hover:border-white/20 cursor-pointer'}`}>{it.l}<span className="block text-[10px] font-medium mt-0.5 opacity-60">{it.c}/{it.m}{full?' 已满':''}</span></button>})}</div></div>}
            {error && <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-2xl"><span className="text-red-400 text-xs">✕</span><span className="text-red-300 text-sm">{error}</span></div>}
            <button onClick={handleSubmit} disabled={loading} className="w-full py-4 rounded-2xl font-bold text-white disabled:opacity-60" style={{ background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)', boxShadow: '0 10px 40px rgba(14,165,233,0.25)' }}>{loading?<span className="inline-flex items-center gap-2"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full" style={{animation:'spin 0.8s linear infinite'}}/>处理中...</span>:mode==='register'?'立即注册':'登录系统'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 交易簿选择页面
// ============================================================
const LedgerSelector = ({ ledgers, currentUser, onSelect, onCreateLedger, showToast }) => {
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [pwd, setPwd] = useState('')
  const [unlocking, setUnlocking] = useState(null)
  const [inputPwd, setInputPwd] = useState('')
  const isAdmin = currentUser.role === UserRole.ADMIN

  const handleCreate = async () => {
    if (!name.trim()) { showToast('请输入交易簿名称', 'warning'); return }
    if (!pwd.trim()) { showToast('请设置密码', 'warning'); return }
    try { await onCreateLedger(name.trim(), pwd); setShowCreate(false); setName(''); setPwd(''); showToast('交易簿已创建', 'success') }
    catch (e) { showToast('创建失败: '+(e.message||''), 'error') }
  }

  const handleUnlock = (l) => {
    if (inputPwd === l.password_hash) { onSelect(l); setInputPwd(''); setUnlocking(null) }
    else { showToast('密码错误', 'error') }
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <div><h1 className="text-2xl font-extrabold text-gray-900">📒 交易簿</h1><p className="text-xs text-gray-400 mt-1">选择一个交易簿开始操作，或创建新的</p></div>
        {isAdmin && <button onClick={() => setShowCreate(true)} className="px-5 py-2.5 rounded-2xl font-bold text-white text-sm" style={{ background: 'linear-gradient(135deg, #0ea5e9, #6366f1)' }}>+ 新建交易簿</button>}
      </div>

      {/* 新建弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center" style={{ backdropFilter: 'blur(8px)', background: 'rgba(0,0,0,0.4)' }}>
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full mx-4 shadow-2xl" style={{ animation: 'scaleIn 0.2s ease-out' }}>
            <h3 className="text-lg font-bold text-gray-900 mb-6">📒 新建交易簿</h3>
            <div className="space-y-4">
              <div><label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">名称</label><input type="text" value={name} onChange={e=>setName(e.target.value)} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-sky-200 text-sm" placeholder="如：2月交易记录" /></div>
              <div><label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">访问密码</label><input type="text" value={pwd} onChange={e=>setPwd(e.target.value)} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-sky-200 text-sm" placeholder="设置该交易簿的密码" /></div>
            </div>
            <div className="flex gap-3 mt-6"><button onClick={()=>setShowCreate(false)} className="flex-1 py-3 rounded-2xl border-2 border-gray-200 text-gray-600 font-semibold hover:bg-gray-50">取消</button><button onClick={handleCreate} className="flex-1 py-3 rounded-2xl text-white font-semibold shadow-lg" style={{ background: 'linear-gradient(135deg, #0ea5e9, #6366f1)' }}>创建</button></div>
          </div>
        </div>
      )}

      {/* 密码解锁弹窗 */}
      {unlocking && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center" style={{ backdropFilter: 'blur(8px)', background: 'rgba(0,0,0,0.4)' }}>
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full mx-4 shadow-2xl" style={{ animation: 'scaleIn 0.2s ease-out' }}>
            <div className="text-center mb-6"><span className="text-4xl">🔐</span><h3 className="text-lg font-bold text-gray-900 mt-3">{unlocking.name}</h3><p className="text-gray-400 text-sm mt-1">请输入密码解锁</p></div>
            <input type="password" value={inputPwd} onChange={e=>setInputPwd(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleUnlock(unlocking)} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-sky-200 text-sm text-center tracking-widest mb-4" placeholder="输入密码" autoFocus />
            <div className="flex gap-3"><button onClick={()=>{setUnlocking(null);setInputPwd('')}} className="flex-1 py-3 rounded-2xl border-2 border-gray-200 text-gray-600 font-semibold hover:bg-gray-50">取消</button><button onClick={()=>handleUnlock(unlocking)} className="flex-1 py-3 rounded-2xl text-white font-semibold shadow-lg" style={{ background: 'linear-gradient(135deg, #0ea5e9, #6366f1)' }}>解锁</button></div>
          </div>
        </div>
      )}

      {/* 交易簿列表 */}
      {ledgers.length === 0 ? (
        <div className="text-center py-20 text-gray-300"><span className="text-6xl block mb-4">📒</span><p className="text-sm">暂无交易簿</p>{isAdmin && <p className="text-xs mt-1">点击右上角"新建交易簿"开始</p>}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {ledgers.map((l, i) => (
            <button key={l.id} onClick={() => { setUnlocking(l); setInputPwd('') }}
              className="bg-white p-6 rounded-2xl border border-gray-100 hover:border-sky-200 hover:shadow-lg transition-all text-left group"
              style={{ animation: `fadeUp 0.4s ease-out ${i*0.06}s both` }}>
              <div className="flex items-start justify-between">
                <div><h3 className="text-lg font-bold text-gray-900 group-hover:text-sky-600 transition-all">📒 {l.name}</h3><p className="text-xs text-gray-400 mt-1">创建人: {l.created_by}</p><p className="text-xs text-gray-300 mt-0.5">{new Date(l.created_at).toLocaleDateString('zh-CN')}</p></div>
                <span className="text-2xl text-gray-200 group-hover:text-sky-400 transition-all">🔐</span>
              </div>
            </button>
          ))}
        </div>
      )}
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
  const [ledgers, setLedgers] = useState([])
  const [activeLedger, setActiveLedger] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [allAttachments, setAllAttachments] = useState([])
  const [activeTab, setActiveTab] = useState('daily')
  const [selectedDate, setSelectedDate] = useState(today())
  const [toast, setToast] = useState(null)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [formData, setFormData] = useState({ price: '', quantity: '', type: TxType.BUY, datetime: localISO(new Date()) })
  const [editingId, setEditingId] = useState(null)
  const [pendingFiles, setPendingFiles] = useState([]) // 新增时暂存附件
  const [txAttachments, setTxAttachments] = useState({}) // { txId: [att, ...] }
  const [expandedTx, setExpandedTx] = useState(null) // 展开查看附件的交易id

  const showToast = useCallback((msg, type='info') => setToast({ message: msg, type, key: Date.now() }), [])
  useEffect(() => { if (currentUser) sessionStorage.setItem('usdt_user', JSON.stringify(currentUser)); else sessionStorage.removeItem('usdt_user') }, [currentUser])

  // 初始化
  useEffect(() => {
    let unsub1, unsub2
    ;(async () => {
      try { const [u, l] = await Promise.all([db.getUsers(), db.getLedgers()]); setUsers(u); setLedgers(l)
        unsub1 = db.subscribeUsers(u => setUsers(u)); unsub2 = db.subscribeLedgers(l => setLedgers(l))
      } catch (e) { console.error(e) }
      setReady(true)
    })()
    return () => { unsub1?.(); unsub2?.() }
  }, [])

  // 切换交易簿后加载交易和附件
  useEffect(() => {
    if (!activeLedger) { setTransactions([]); setAllAttachments([]); return }
    let unsubTx
    ;(async () => {
      const [txs, atts] = await Promise.all([db.getTransactions(activeLedger.id), db.getAllAttachments(activeLedger.id)])
      setTransactions(txs); setAllAttachments(atts)
      unsubTx = db.subscribeTx(activeLedger.id, txs => setTransactions(txs))
    })()
    return () => { unsubTx?.() }
  }, [activeLedger])

  // 按交易ID分组附件
  useEffect(() => {
    const map = {}; allAttachments.forEach(a => { if (!map[a.transaction_id]) map[a.transaction_id] = []; map[a.transaction_id].push(a) })
    setTxAttachments(map)
  }, [allAttachments])

  // 同步表单日期
  useEffect(() => { if (!editingId) { const now = new Date(); const [y,m,d] = selectedDate.split('-').map(Number); setFormData(p => ({...p, datetime: localISO(new Date(y,m-1,d,now.getHours(),now.getMinutes(),now.getSeconds()))})) } }, [selectedDate, editingId])

  const handleRegister = async (un, pw, role) => {
    if (users.find(u => u.username === un)) { showToast('用户名已存在', 'error'); return false }
    if (role === UserRole.ADMIN && users.filter(u => u.role === UserRole.ADMIN).length >= 1) { showToast('最多1个管理员', 'error'); return false }
    if (role === UserRole.OPERATOR && users.filter(u => u.role === UserRole.OPERATOR).length >= 2) { showToast('最多2个操作员', 'error'); return false }
    try { await db.registerUser({ username: un, password_hash: pw, role }); showToast('注册成功', 'success'); return true } catch { showToast('注册失败', 'error'); return false }
  }

  const handleLoginAttempt = async (un, pw) => { const u = await db.loginUser(un, pw); if (u) { setCurrentUser(u); showToast(`欢迎，${u.username}！`, 'success'); return true }; return false }

  const handleCreateLedger = async (name, pwd) => {
    await db.createLedger({ id: genId(), name, password_hash: pwd, created_by: currentUser.username, created_at: new Date().toISOString() })
  }

  // 每日汇总
  const summary = useMemo(() => {
    const sorted = [...transactions].sort((a,b) => new Date(a.timestamp).getTime()-new Date(b.timestamp).getTime())
    let tQ=0,tC=0
    sorted.filter(t => t.date_str < selectedDate).forEach(t => { if(t.type===TxType.BUY){tC+=t.total;tQ+=t.quantity}else{const a=tQ>0?tC/tQ:0;tQ=Math.max(0,tQ-t.quantity);tC=tQ*a} })
    let dBQ=0,dBA=0,dSQ=0,dSA=0,dP=0
    const dayTxs = sorted.filter(t => t.date_str === selectedDate)
    dayTxs.forEach(t => { if(t.type===TxType.BUY){dBQ+=t.quantity;dBA+=t.total;tQ+=t.quantity;tC+=t.total}else{const a=tQ>0?tC/tQ:0;dSQ+=t.quantity;dSA+=t.total;dP+=(t.price-a)*t.quantity;tQ=Math.max(0,tQ-t.quantity);tC=tQ*a} })
    return { dayBuyQty:dBQ, dayBuyAmt:dBA, daySellQty:dSQ, daySellAmt:dSA, closingBal:tQ, avgCost:tQ>0?tC/tQ:0, dayProfit:dP, dayTxs }
  }, [transactions, selectedDate])

  // 周报
  const weeklyData = useMemo(() => {
    const sorted = [...transactions].sort((a,b)=>new Date(a.timestamp).getTime()-new Date(b.timestamp).getTime())
    const weeks = new Map(); let cQ=0,cC=0
    sorted.forEach(t => { const wk=getWeekKey(new Date(t.timestamp)); if(!weeks.has(wk)) weeks.set(wk,{weekKey:wk,buyQty:0,buyAmt:0,sellQty:0,sellAmt:0,profit:0}); const w=weeks.get(wk); if(t.type===TxType.BUY){w.buyQty+=t.quantity;w.buyAmt+=t.total;cQ+=t.quantity;cC+=t.total}else{const a=cQ>0?cC/cQ:0;w.sellQty+=t.quantity;w.sellAmt+=t.total;w.profit+=(t.price-a)*t.quantity;cQ=Math.max(0,cQ-t.quantity);cC=cQ*a} })
    return Array.from(weeks.values()).reverse()
  }, [transactions])

  // 添加/编辑交易
  const handleTxSubmit = async () => {
    if (!formData.price || !formData.quantity) { showToast('请填写价格和数量', 'warning'); return }
    const price = parseFloat(formData.price), quantity = parseFloat(formData.quantity)
    if (isNaN(price)||isNaN(quantity)||price<=0||quantity<=0) { showToast('必须为正数', 'warning'); return }
    const fullTs = new Date(formData.datetime).toISOString(), datePart = formData.datetime.split('T')[0]
    setSyncing(true)
    try {
      if (editingId) {
        const tx = transactions.find(t => t.id === editingId)
        const ec = currentUser?.role === UserRole.OPERATOR ? (tx?.edit_count||0)+1 : (tx?.edit_count||0)
        await db.updateTransaction(editingId, { price, quantity, total: price*quantity, type: formData.type, timestamp: fullTs, date_str: datePart, edit_count: ec })
        setEditingId(null); showToast('已更新', 'success')
      } else {
        const txId = genId()
        await db.addTransaction({ id: txId, price, quantity, total: price*quantity, type: formData.type, timestamp: fullTs, date_str: datePart, edit_count: 0, operator_name: currentUser?.username||'', ledger_id: activeLedger.id })
        // 上传暂存的附件
        if (pendingFiles.length > 0) {
          for (const file of pendingFiles) {
            const info = await db.uploadFile(file, txId, activeLedger.id)
            await db.addAttachment({ id: genId(), transaction_id: txId, ledger_id: activeLedger.id, ...info, created_at: new Date().toISOString() })
          }
          const atts = await db.getAllAttachments(activeLedger.id)
          setAllAttachments(atts)
          setPendingFiles([])
        }
        showToast(formData.type===TxType.BUY?'进货已添加':'出货已添加', 'success')
      }
    } catch (e) { showToast('失败: '+(e.message||''), 'error') }
    setFormData(p => ({...p, price:'', quantity:''})); setSyncing(false)
  }

  const handleEdit = (tx) => {
    if (currentUser?.role === UserRole.OPERATOR && tx.edit_count >= 1) { showToast('修改次数已达上限', 'warning'); return }
    setEditingId(tx.id); setFormData({ price: String(tx.price), quantity: String(tx.quantity), type: tx.type, datetime: localISO(new Date(tx.timestamp)) })
    showToast('正在编辑', 'info')
  }

  const handleDelete = (tx) => {
    if (currentUser?.role !== UserRole.ADMIN) return
    setConfirmDialog({ title: '删除确认', message: `确定删除这条${tx.type===TxType.BUY?'进货':'出货'}记录及其所有附件？`,
      onConfirm: async () => { setSyncing(true); try { await db.deleteTransaction(tx.id); const atts = await db.getAllAttachments(activeLedger.id); setAllAttachments(atts); showToast('已删除', 'success') } catch { showToast('失败', 'error') } setSyncing(false); setConfirmDialog(null) },
      onCancel: () => setConfirmDialog(null) })
  }

  // 加载中
  if (!ready) return <div className="min-h-screen flex items-center justify-center" style={{ background: '#0f172a' }}><div className="text-center"><div className="w-12 h-12 mx-auto border-[3px] border-sky-400/30 border-t-sky-400 rounded-full" style={{ animation: 'spin 0.8s linear infinite' }} /><p className="text-sky-300/50 mt-4 text-sm">正在连接服务器...</p></div></div>

  // 未登录
  if (!currentUser) return <><LoginPage onLogin={setCurrentUser} onRegister={handleRegister} users={users} onLoginAttempt={handleLoginAttempt} />{toast && <Toast message={toast.message} type={toast.type} onClose={()=>setToast(null)} />}</>

  const isAdmin = currentUser.role === UserRole.ADMIN

  // 未选择交易簿
  if (!activeLedger) return (
    <div className="min-h-screen flex flex-col" style={{ background: '#f8fafc' }}>
      <header className="bg-white/80 backdrop-blur-xl border-b border-gray-100 sticky top-0 z-50" style={{ boxShadow: '0 1px 20px rgba(0,0,0,0.04)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5"><div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-sm" style={{ background: 'linear-gradient(135deg, #0ea5e9, #6366f1)' }}>U₮</div><span className="font-extrabold text-lg text-gray-900 hidden sm:block">USDT-Tracker</span></div>
          <div className="flex items-center gap-3"><div className="hidden sm:block text-right mr-1"><p className="text-[11px] text-gray-400">{isAdmin?'管理员':'操作员'}</p><p className="text-sm font-bold text-gray-700">{currentUser.username}</p></div><button onClick={()=>setCurrentUser(null)} className="w-9 h-9 rounded-xl bg-gray-50 hover:bg-red-50 text-gray-400 hover:text-red-500 flex items-center justify-center" title="退出"><svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg></button></div>
        </div>
      </header>
      <LedgerSelector ledgers={ledgers} currentUser={currentUser} onSelect={setActiveLedger} onCreateLedger={handleCreateLedger} showToast={showToast} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={()=>setToast(null)} />}
    </div>
  )

  // 新增附件暂存
  const pendingFileRef = useRef(null)
  const handlePendingFiles = (e) => {
    const files = Array.from(e.target.files||[])
    if (pendingFiles.length + files.length > MAX_ATTACHMENTS) { showToast(`最多${MAX_ATTACHMENTS}个附件`, 'warning'); return }
    for (const f of files) { if (f.size > MAX_FILE_SIZE) { showToast(`${f.name} 超过200MB`, 'error'); return } }
    setPendingFiles(prev => [...prev, ...files])
    if (pendingFileRef.current) pendingFileRef.current.value = ''
  }

  const previewTotal = formData.price && formData.quantity ? parseFloat(formData.price) * parseFloat(formData.quantity) : null

  // ===== 主界面 =====
  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onClose={()=>setToast(null)} />}
      {confirmDialog && <ConfirmDialog {...confirmDialog} />}
      <div className="min-h-screen flex flex-col" style={{ background: '#f8fafc' }}>
        {/* 导航 */}
        <header className="bg-white/80 backdrop-blur-xl border-b border-gray-100 sticky top-0 z-50" style={{ boxShadow: '0 1px 20px rgba(0,0,0,0.04)' }}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={() => setActiveLedger(null)} className="flex items-center gap-2 hover:opacity-70 transition-all" title="返回交易簿列表">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-sm" style={{ background: 'linear-gradient(135deg, #0ea5e9, #6366f1)' }}>U₮</div>
                <span className="font-extrabold text-lg text-gray-900 hidden sm:block">USDT-Tracker</span>
              </button>
              <span className="hidden sm:inline text-gray-300">|</span>
              <span className="text-sm font-bold text-sky-600 hidden sm:inline">📒 {activeLedger.name}</span>
              {syncing ? <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 bg-sky-50 text-sky-500 rounded-lg text-[10px] font-bold"><span className="w-2 h-2 bg-sky-400 rounded-full" style={{animation:'spin 1s linear infinite'}}/>同步中</span>
                : <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-500 rounded-lg text-[10px] font-bold"><span className="w-1.5 h-1.5 bg-emerald-400 rounded-full"/>已连接</span>}
              <nav className="hidden md:flex items-center gap-1">
                {[['daily','📊 每日记录'],['weekly','📈 汇总报表'],['settings','⚙️ 设置']].map(([k,l])=><button key={k} onClick={()=>setActiveTab(k)} className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${activeTab===k?'bg-sky-50 text-sky-600':'text-gray-400 hover:text-gray-700 hover:bg-gray-50'}`}>{l}</button>)}
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:block text-right mr-1"><p className="text-[11px] text-gray-400">{isAdmin?'管理员':'操作员'}</p><p className="text-sm font-bold text-gray-700">{currentUser.username}</p></div>
              <button onClick={()=>setCurrentUser(null)} className="w-9 h-9 rounded-xl bg-gray-50 hover:bg-red-50 text-gray-400 hover:text-red-500 flex items-center justify-center"><svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg></button>
            </div>
          </div>
          <nav className="md:hidden flex items-center justify-around border-t border-gray-50 py-1.5 bg-white">
            {[['daily','📊','每日'],['weekly','📈','报表'],['settings','⚙️','设置']].map(([k,ic,l])=><button key={k} onClick={()=>setActiveTab(k)} className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-all ${activeTab===k?'text-sky-600 bg-sky-50':'text-gray-400'}`}><span className="text-base">{ic}</span><span className="text-[10px] font-bold">{l}</span></button>)}
          </nav>
        </header>

        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
          {/* ===== 每日 ===== */}
          {activeTab === 'daily' && <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3"><input type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)} className="px-4 py-2.5 bg-white border border-gray-200 rounded-2xl shadow-sm focus:ring-2 focus:ring-sky-200 outline-none font-semibold text-gray-700 text-sm" /><div><h1 className="text-xl font-extrabold text-gray-900">交易流水</h1><p className="text-xs text-gray-400 mt-0.5">结存自动转入次日</p></div></div>
              <div className="flex gap-2">
                <button onClick={()=>{const d=new Date(selectedDate);d.setDate(d.getDate()-1);setSelectedDate(d.toISOString().split('T')[0])}} className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-gray-500 hover:bg-gray-50 text-sm font-medium">← 前一天</button>
                <button onClick={()=>setSelectedDate(today())} className="px-3 py-2 bg-sky-50 border border-sky-200 rounded-xl text-sky-600 hover:bg-sky-100 text-sm font-bold">今天</button>
                <button onClick={()=>{const d=new Date(selectedDate);d.setDate(d.getDate()+1);setSelectedDate(d.toISOString().split('T')[0])}} className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-gray-500 hover:bg-gray-50 text-sm font-medium">后一天 →</button>
              </div>
            </div>

            {/* 统计卡片 */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {[{label:'当日进货',value:`${fmt(summary.dayBuyQty)} USDT`,sub:`成本 ¥${fmt(summary.dayBuyAmt)}`,color:'text-sky-600',icon:'📥'},
                {label:'当日出货',value:`${fmt(summary.daySellQty)} USDT`,sub:`营收 ¥${fmt(summary.daySellAmt)}`,color:'text-amber-600',icon:'📤'},
                {label:'当日利润',value:`¥${fmt(summary.dayProfit)}`,sub:'加权平均成本',color:summary.dayProfit>=0?'text-emerald-600':'text-red-600',icon:summary.dayProfit>=0?'📈':'📉'},
                {label:'当前仓位',value:`${fmt(summary.closingBal)} USDT`,sub:`均价 ¥${fmt(summary.avgCost)}`,color:'text-violet-600',icon:'💰',hl:true}
              ].map((c,i)=><div key={i} className={`bg-white p-4 sm:p-5 rounded-2xl border hover:shadow-md transition-all ${c.hl?'border-violet-200 ring-2 ring-violet-100':'border-gray-100'}`} style={{animation:`fadeUp 0.4s ease-out ${i*0.08}s both`}}><div className="flex items-start justify-between mb-2"><p className="text-[11px] font-bold text-gray-400 uppercase">{c.label}</p><span className="text-lg">{c.icon}</span></div><p className={`text-xl sm:text-2xl font-extrabold ${c.color}`}>{c.value}</p><p className="text-[11px] text-gray-400 mt-1.5">{c.sub}</p></div>)}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* 表单 */}
              <div className="lg:col-span-1"><div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm sticky top-28">
                <h3 className="text-base font-extrabold text-gray-900 mb-5 flex items-center gap-2"><span className="w-1.5 h-5 rounded-full" style={{background:editingId?'linear-gradient(180deg,#f59e0b,#ef4444)':'linear-gradient(180deg,#0ea5e9,#6366f1)'}}/>{editingId?'✏️ 编辑记录':'📝 新增记录'}</h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2 p-1 bg-gray-50 rounded-2xl">{[{t:TxType.BUY,l:'📥 进货',g:'linear-gradient(135deg,#0ea5e9,#0284c7)'},{t:TxType.SELL,l:'📤 出货',g:'linear-gradient(135deg,#f59e0b,#d97706)'}].map(b=><button key={b.t} onClick={()=>setFormData(p=>({...p,type:b.t}))} className={`py-2.5 rounded-xl text-sm font-bold transition-all ${formData.type===b.t?'text-white shadow-lg':'text-gray-400'}`} style={formData.type===b.t?{background:b.g}:{}}>{b.l}</button>)}</div>
                  <div className="grid grid-cols-2 gap-3"><div><label className="block text-[11px] font-bold text-gray-400 uppercase mb-1.5 ml-1">单价 (¥)</label><input type="number" step="0.0001" value={formData.price} onChange={e=>setFormData(p=>({...p,price:e.target.value}))} onKeyDown={e=>e.key==='Enter'&&handleTxSubmit()} className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-sky-200 text-sm font-medium" placeholder="7.25"/></div><div><label className="block text-[11px] font-bold text-gray-400 uppercase mb-1.5 ml-1">数量 (USDT)</label><input type="number" step="0.01" value={formData.quantity} onChange={e=>setFormData(p=>({...p,quantity:e.target.value}))} onKeyDown={e=>e.key==='Enter'&&handleTxSubmit()} className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-sky-200 text-sm font-medium" placeholder="1000"/></div></div>
                  {previewTotal!==null&&!isNaN(previewTotal)&&previewTotal>0&&<div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-xl border border-dashed border-gray-200"><span className="text-xs text-gray-400">预计金额</span><span className="text-base font-extrabold text-gray-700">¥{fmt(previewTotal)}</span></div>}
                  <div><label className="block text-[11px] font-bold text-gray-400 uppercase mb-1.5 ml-1">交易时间</label><input type="datetime-local" step="1" value={formData.datetime} onChange={e=>setFormData(p=>({...p,datetime:e.target.value}))} className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-sky-200 text-sm font-medium"/></div>

                  {/* 申诉存证 - 新增模式 */}
                  {!editingId && <div>
                    <label className="block text-[11px] font-bold text-gray-400 uppercase mb-1.5 ml-1">📎 申诉存证</label>
                    <input ref={pendingFileRef} type="file" multiple accept="image/*,video/*,audio/*,.mp4,.mov,.avi,.mp3,.wav,.m4a,.aac,.amr,.3gp,.m4v,.webm" onChange={handlePendingFiles} className="hidden" />
                    {pendingFiles.length > 0 && <div className="flex flex-wrap gap-1.5 mb-2">{pendingFiles.map((f,i)=><div key={i} className="relative group"><div className="w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center text-lg border border-gray-200">{getFileType(f.name)==='image'?'🖼️':getFileType(f.name)==='video'?'🎬':getFileType(f.name)==='audio'?'🎵':'📄'}</div><button onClick={()=>setPendingFiles(p=>p.filter((_,j)=>j!==i))} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100">✕</button><p className="text-[9px] text-gray-400 truncate w-14 text-center mt-0.5">{f.name}</p></div>)}</div>}
                    <button onClick={()=>pendingFileRef.current?.click()} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 border border-dashed border-gray-300 rounded-xl text-xs text-gray-500 hover:text-gray-700">📎 添加存证 ({pendingFiles.length}/{MAX_ATTACHMENTS})</button>
                  </div>}

                  <button onClick={handleTxSubmit} disabled={syncing} className="w-full py-3.5 rounded-2xl font-bold text-white active:scale-[0.97] shadow-lg disabled:opacity-60" style={{background:editingId?'linear-gradient(135deg,#f59e0b,#ef4444)':'linear-gradient(135deg,#0ea5e9,#6366f1)'}}>{syncing?'同步中...':editingId?'💾 保存修改':'✅ 确认录入'}</button>
                  {editingId&&<button onClick={()=>{setEditingId(null);setFormData(p=>({...p,price:'',quantity:''}))}} className="w-full py-2.5 text-gray-400 hover:text-gray-600 text-sm font-medium">取消编辑</button>}
                </div>
              </div></div>

              {/* 列表 */}
              <div className="lg:col-span-2"><div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col" style={{maxHeight:'800px'}}>
                <div className="p-4 border-b border-gray-50 bg-gray-50/50"><span className="font-bold text-gray-700 text-sm">流水列表 ({summary.dayTxs.length} 条)</span></div>
                <div className="overflow-y-auto flex-1">
                  {summary.dayTxs.length===0?<div className="flex flex-col items-center justify-center py-20 text-gray-300"><span className="text-5xl mb-4">📋</span><p className="text-sm">当日暂无记录</p></div>:(
                    <div className="divide-y divide-gray-50">
                      {summary.dayTxs.map((t,i) => {
                        const atts = txAttachments[t.id] || []
                        const isExpanded = expandedTx === t.id
                        return (
                          <div key={t.id} className="hover:bg-sky-50/20 transition-all" style={{animation:`fadeUp 0.3s ease-out ${i*0.04}s both`}}>
                            <div className="flex items-center px-4 py-3 gap-3">
                              <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold shrink-0 ${t.type===TxType.BUY?'bg-sky-50 text-sky-600':'bg-amber-50 text-amber-600'}`}>{t.type===TxType.BUY?'📥 进货':'📤 出货'}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-3"><span className="text-sm font-semibold text-gray-700">¥{t.price}</span><span className="text-sm text-gray-500">× {fmt(t.quantity)}</span><span className="text-sm text-gray-400">=¥{fmt(t.total)}</span></div>
                                <p className="text-[11px] text-gray-400 mt-0.5">{fmtDate(t.timestamp)} · {t.operator_name}</p>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {atts.length > 0 && <button onClick={()=>setExpandedTx(isExpanded?null:t.id)} className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${isExpanded?'bg-sky-100 text-sky-600':'text-gray-300 hover:text-sky-500 hover:bg-sky-50'}`} title={`${atts.length}个附件`}><span className="text-sm">📎</span></button>}
                                <button onClick={()=>handleEdit(t)} disabled={currentUser?.role===UserRole.OPERATOR&&t.edit_count>=1} className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${currentUser?.role===UserRole.OPERATOR&&t.edit_count>=1?'text-gray-200 cursor-not-allowed':'text-gray-300 hover:text-sky-500 hover:bg-sky-50'}`}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
                                {isAdmin&&<button onClick={()=>handleDelete(t)} className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>}
                              </div>
                            </div>
                            {/* 展开的附件区域 */}
                            {isExpanded && <div className="px-4 pb-3">
                              <AttachmentPanel txId={t.id} ledgerId={activeLedger.id} attachments={atts}
                                setAttachments={(fn) => { const newAtts = typeof fn === 'function' ? fn(atts) : fn; setAllAttachments(prev => { const filtered = prev.filter(a => a.transaction_id !== t.id); return [...filtered, ...newAtts] }) }}
                                showToast={showToast} readOnly={false} />
                            </div>}
                            {/* 没展开但有附件时显示小标记 */}
                            {!isExpanded && atts.length > 0 && <div className="px-4 pb-2"><span className="text-[10px] text-gray-300">📎 {atts.length}个存证附件 · 点击📎查看</span></div>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div></div>
            </div>
          </div>}

          {/* ===== 周报 ===== */}
          {activeTab==='weekly'&&<div className="space-y-6">
            <div><h1 className="text-2xl font-extrabold text-gray-900">📈 周度财务汇总</h1><p className="text-xs text-gray-400 mt-1">基于加权平均成本自动计算</p></div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-left">
              <thead className="bg-gray-50/80 border-b border-gray-100"><tr>{['周期','进货(USDT)','进货成本(¥)','出货(USDT)','出货金额(¥)','净利润(¥)'].map(h=><th key={h} className="px-5 py-4 text-[10px] font-bold text-gray-400 uppercase text-right first:text-left">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-50">{weeklyData.length===0?<tr><td colSpan={6} className="px-6 py-16 text-center text-gray-300 text-sm italic">暂无数据</td></tr>:weeklyData.map((w,i)=><tr key={w.weekKey} className="hover:bg-sky-50/20" style={{animation:`fadeUp 0.3s ease-out ${i*0.05}s both`}}><td className="px-5 py-4 font-bold text-gray-700 text-sm">{w.weekKey.replace('-W','年第')}周</td><td className="px-5 py-4 text-right text-sm text-sky-600 font-semibold">{fmt(w.buyQty)}</td><td className="px-5 py-4 text-right text-sm text-gray-500">¥{fmt(w.buyAmt)}</td><td className="px-5 py-4 text-right text-sm text-amber-600 font-semibold">{fmt(w.sellQty)}</td><td className="px-5 py-4 text-right text-sm text-gray-500">¥{fmt(w.sellAmt)}</td><td className={`px-5 py-4 text-right text-base font-extrabold ${w.profit>=0?'text-emerald-600':'text-red-600'}`}>{w.profit>=0?'+':''}¥{fmt(w.profit)}</td></tr>)}</tbody>
              {weeklyData.length>0&&<tfoot className="bg-gray-50 font-bold border-t-2 border-gray-200"><tr><td className="px-5 py-4 text-sm">合计</td><td className="px-5 py-4 text-right text-sky-700 text-sm">{fmt(weeklyData.reduce((a,w)=>a+w.buyQty,0))}</td><td className="px-5 py-4 text-right text-sm">¥{fmt(weeklyData.reduce((a,w)=>a+w.buyAmt,0))}</td><td className="px-5 py-4 text-right text-amber-700 text-sm">{fmt(weeklyData.reduce((a,w)=>a+w.sellQty,0))}</td><td className="px-5 py-4 text-right text-sm">¥{fmt(weeklyData.reduce((a,w)=>a+w.sellAmt,0))}</td>{(()=>{const t=weeklyData.reduce((a,w)=>a+w.profit,0);return <td className={`px-5 py-4 text-right text-lg ${t>=0?'text-emerald-700':'text-red-700'}`}>{t>=0?'+':''}¥{fmt(t)}</td>})()}</tr></tfoot>}
            </table></div></div>
          </div>}

          {/* ===== 设置 ===== */}
          {activeTab==='settings'&&<div className="max-w-2xl mx-auto space-y-6">
            <h1 className="text-2xl font-extrabold text-gray-900">⚙️ 设置</h1>
            <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-gray-400 uppercase">账户信息</h3>
              <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-2xl"><div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-black" style={{background:'linear-gradient(135deg,#0ea5e9,#6366f1)'}}>{currentUser.username.slice(0,1).toUpperCase()}</div><div><p className="font-bold text-gray-900 text-lg">{currentUser.username}</p><p className="text-sky-600 text-sm font-semibold">{isAdmin?'🛡️ 管理员':'👤 操作员'}</p></div></div>
              <div className="grid grid-cols-3 gap-3"><div className="p-4 bg-sky-50 rounded-2xl text-center"><p className="text-2xl font-extrabold text-sky-600">{transactions.length}</p><p className="text-xs text-sky-500 mt-1">交易笔数</p></div><div className="p-4 bg-violet-50 rounded-2xl text-center"><p className="text-2xl font-extrabold text-violet-600">{ledgers.length}</p><p className="text-xs text-violet-500 mt-1">交易簿</p></div><div className="p-4 bg-emerald-50 rounded-2xl text-center"><p className="text-2xl font-extrabold text-emerald-600">☁️</p><p className="text-xs text-emerald-500 mt-1">云端同步</p></div></div>
            </div>
            {isAdmin&&<div className="bg-white p-6 rounded-2xl border-2 border-red-100 shadow-sm">
              <h3 className="text-sm font-bold text-red-500 uppercase mb-4">⚠️ 危险操作</h3>
              <div className="flex flex-col gap-3">
                <button onClick={()=>setConfirmDialog({title:'清空交易',message:`确定清空「${activeLedger.name}」的所有交易数据和附件？`,onConfirm:async()=>{setSyncing(true);try{await db.deleteAllTransactions(activeLedger.id);const atts=await db.getAllAttachments(activeLedger.id);setAllAttachments(atts);showToast('已清空','success')}catch{showToast('失败','error')}setSyncing(false);setConfirmDialog(null)},onCancel:()=>setConfirmDialog(null)})} className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-2xl font-bold shadow-lg shadow-red-100 text-left">🗑️ 清空当前交易簿数据</button>
                <button onClick={()=>setConfirmDialog({title:'删除交易簿',message:`确定删除「${activeLedger.name}」？所有数据和附件将永久丢失！`,onConfirm:async()=>{setSyncing(true);try{await db.deleteLedger(activeLedger.id);setActiveLedger(null);showToast('已删除','success')}catch{showToast('失败','error')}setSyncing(false);setConfirmDialog(null)},onCancel:()=>setConfirmDialog(null)})} className="px-6 py-3 bg-gray-700 hover:bg-gray-800 text-white rounded-2xl font-bold shadow-lg text-left">🔥 删除此交易簿</button>
              </div>
            </div>}
          </div>}
        </main>
        <footer className="bg-white border-t border-gray-100 py-4 text-center text-xs text-gray-300">USDT 管理系统 © {new Date().getFullYear()} — ☁️ 云端同步</footer>
      </div>
    </>
  )
}


