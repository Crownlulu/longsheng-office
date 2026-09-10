import { useRef, useState } from 'react'
import { ArrowUp, Loader2, MessageSquare, Plus, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { officeApi, errorText } from './api'
import { Orders, RoleAction, Tasks } from './business'
import { ErrorNotice, RunContent, Section } from './shared'
import { roleNames, type Action, type AssistantSession, type History, type ModelConfig, type Role, type Run, type Snapshot, type Source, type Task } from './types'
import { ReviewSummary } from './workflow-overview'

const prompts = [
  ['查询到料影响', '供应商 A 延期会影响哪些订单？有几条需要处理？'],
  ['核对会议决定', '这件事之前怎么决定的？现在应以哪条决定为准？'],
  ['比较供应方案', '比较 A 和 B 方案，我能否改用 B？还缺什么条件？'],
  ['查询处理进度', '这件事现在处理到哪里了？'],
]
type Props = {
  role: Role; config: ModelConfig | null; history: History; snapshot: Snapshot
  session: AssistantSession; updateSession: (patch: Partial<AssistantSession>) => void
  sources: Source[]; refresh: () => Promise<void>; openSource: (source: Source) => void
  propose: (action: Action, expectedVersion?: number) => void
  giveReceipt: (task: Task) => void; viewMatter: () => void; actionBusy: boolean
}
export function Assistant({ role, config, history, snapshot, session, updateSession, sources, refresh, openSource, propose, giveReceipt, viewMatter, actionBusy }: Props) {
  const lock = useRef(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedback, setFeedback] = useState('')
  const { busy, error, run, historical, failedQuestion, question, planReason } = session
  const { state, analysis } = snapshot
  const plan = state.matter.planSelection?.supplierId ?? (state.tasks.some(t => t.id === 'T-QA') ? 'B' : undefined)
  const planLocked = state.matter.status === 'closed' || analysis.executionApproved
  const canSelect = ['lead', 'procurement'].includes(role) && !planLocked
  const qaActive = state.tasks.some(t => t.id === 'T-QA' && t.status !== 'completed')
  const ownHistory = history.runs.filter(item => item.role === role && item.mode === config?.mode && item.variant === 'ontology')
  const ids = session.messageIds ?? (run ? [run.id] : [])
  const messages = ids.map(id => run?.id === id ? run : ownHistory.find(item => item.id === id)).filter((item): item is Run => !!item)
  const act = (action: Action) => propose(action, state.revision)
  const planQuery = !!run && /方案|切换|改用|不满意/.test(run.question) && run.status === 'completed'
  const showPlans = !historical && (session.showPlans || planQuery)
  const showWork = !historical && (!!plan || analysis.executionApproved)

  async function submit(input = question) {
    const requested = input.trim()
    if (!requested || busy || lock.current) return
    lock.current = true
    updateSession({ busy: true, question: requested, error: '', failedQuestion: '', snapshotReady: false, historical: false })
    try {
      const result = await officeApi<{ run: Run }>('/chat', role, { question: requested, mode: config?.mode || 'rules' })
      updateSession({ run: result.run, question: '', messageIds: [...ids, result.run.id], failedQuestion: result.run.status === 'failed' ? requested : '' })
      await refresh()
      updateSession({ snapshotReady: true })
    } catch (failure) {
      updateSession({ error: errorText(failure), failedQuestion: requested })
    } finally {
      lock.current = false
      updateSession({ busy: false })
    }
  }
  return <div className='office-chat'>
    <aside className='office-chat-history' aria-label='历史会话'>
      <div className='mb-4 flex items-center justify-between gap-2'><h2 className='font-semibold'>历史会话</h2><Button size='sm' variant='outline' disabled={busy} onClick={() => updateSession({ run: null, messageIds: [], question: '', historical: false, error: '', failedQuestion: '', showPlans: false })}><Plus className='size-4' />新建</Button></div>
      <p className='mb-4 text-xs text-muted-foreground'>{roleNames[role]} · 当前事项</p>
      {!ownHistory.length && <p className='text-sm text-muted-foreground'>暂无历史问答</p>}
      {ownHistory.map(item => <button key={item.id} disabled={busy} className={'mb-2 block w-full rounded-lg border p-3 text-left hover:bg-muted ' + (run?.id === item.id ? 'border-primary bg-muted' : '')} onClick={() => updateSession({ run: item, messageIds: [item.id], historical: true, error: '', failedQuestion: item.status === 'failed' ? item.question : '' })}>
        <p className='line-clamp-2 break-words text-sm leading-6'>{item.question}</p><p className='mt-2 text-xs text-muted-foreground'>{new Date(item.createdAt).toLocaleString('zh-CN')} · v{item.revision}</p>
      </button>)}
    </aside>
    <div className='office-chat-main'>
      <div className='flex flex-wrap items-center justify-between gap-3 border-b bg-card p-4'>
        <div><h2 className='font-semibold'>{state.matter.title}</h2><p className='mt-1 text-sm text-muted-foreground'>{state.matter.id} · {roleNames[role]}</p></div>
        <Button variant='outline' size='sm' onClick={viewMatter}>查看事项详情</Button>
      </div>
      <div className='office-chat-messages' aria-live='polite'>
        {!messages.length && <div className='py-8'><MessageSquare className='mb-4 size-7 text-primary' /><h3 className='text-xl font-semibold'>从一个问题开始办理</h3><p className='mt-3 text-sm leading-7 text-muted-foreground'>供应商 A 原定 D{state.suppliers[0]?.originalDay}，现预计 D{state.suppliers[0]?.arrivalDay} 到料。你可以先查询影响或核对会议依据。</p></div>}
        <div className='mb-5 flex flex-wrap gap-2'>{prompts.map(([label, value]) => <Button key={label} size='sm' variant='outline' disabled={busy} onClick={() => void submit(value)}>{label}</Button>)}</div>
        {messages.map(item => <div key={item.id} className='mb-6 space-y-3'>
          <div className='ml-auto max-w-[90%] rounded-xl bg-primary/10 p-4 text-sm leading-7 whitespace-pre-wrap break-words'>{item.question}</div>
          <Section title={historical ? '历史回答' : '查询结果'} aside={<Badge variant='outline'>数据 v{item.revision}</Badge>}>
            {item.revision !== state.revision && <p className='mb-3 text-sm text-muted-foreground'>保留查询当时的回答与数据；当前事项已更新为 v{state.revision}。</p>}
            <RunContent run={item} openSource={openSource} />
            {item.status === 'completed' && item.facts && /影响|订单|到料/.test(item.question) && !/方案|切换|改用|不满意/.test(item.question) && <div className='mt-4'><Orders snapshot={{ ...snapshot, state: item.facts.state, analysis: item.facts.analysis }} /></div>}
          </Section>
        </div>)}
        <ErrorNotice message={error} />
        {busy && <p role='status' className='flex items-center gap-2 p-4 text-sm'><Loader2 className='size-4 animate-spin' />正在查询事项资料…</p>}
        {failedQuestion && !busy && <Button variant='outline' onClick={() => void submit(failedQuestion)}><RotateCcw className='size-4' />重试原问题</Button>}
        {historical && <Button variant='outline' onClick={() => updateSession({ historical: false })}>返回当前事项办理</Button>}
        {!historical && !!run && !showPlans && !plan && run.status === 'completed' && <Button variant='outline' onClick={() => updateSession({ showPlans: true })}>继续比较并选择方案</Button>}
        {showPlans && <Section title='比较并选择方案' aside={<Badge variant='outline'>{plan ? `已选 ${plan} · ${analysis.executionApproved ? '已批准' : '未批准'}` : '待选择'}</Badge>}>
          <div className='grid gap-3 md:grid-cols-2'>{analysis.options.map(option => <div key={option.supplierId} className={'rounded-lg border p-4 ' + (plan === option.supplierId ? 'border-primary bg-primary/5' : '')}>
            <h3 className='font-semibold'>{option.name}</h3><p className='mt-3 text-sm'>预计 D{option.arrivalDay} 到料 · {option.riskCount} 条到料风险</p><p className='mt-3 text-sm leading-6 text-muted-foreground'>{option.supplierId === 'A' ? '沿用现有供货安排；到料风险须由负责人确认并跟进。' : '可提早到料；必须完成方案质量核验和负责人批准。'}</p>
            <Button className='mt-4 w-full' variant={plan === option.supplierId ? 'default' : 'outline'} disabled={!canSelect || actionBusy || busy || plan === option.supplierId || (option.supplierId === 'A' && qaActive)} onClick={() => act({ type: 'select_plan', supplierId: option.supplierId, evidence: planReason })}>{plan === option.supplierId ? `已选择 ${plan}` : `选择 ${option.supplierId} 方案`}</Button>
          </div>)}</div>
          {state.matter.planSelection && <p className='mt-4 text-sm leading-6'>选择依据：{state.matter.planSelection.reason}</p>}
          {canSelect && <div className='mt-4 space-y-3'><label htmlFor='office-plan-reason' className='text-sm font-medium'>补充选择理由（可选）</label><Textarea id='office-plan-reason' value={planReason} maxLength={4000} onChange={e => updateSession({ planReason: e.target.value })} placeholder='系统会带出方案依据；你也可以补充考虑因素。' /><Button variant='outline' disabled={busy || actionBusy} onClick={() => setFeedbackOpen(true)}>都不满意 / 重新生成方案</Button></div>}
          <p className='mt-3 text-sm text-muted-foreground'>选择仅记录意向，尚需批准及单独确认发送任务。</p>
        </Section>}
        {showWork && <div className='mt-5 space-y-5'>
          <div role='region' aria-label='当前办理'><RoleAction title={analysis.executionApproved ? analysis.canClose ? '最终人工复核' : '部门执行' : plan === 'B' ? '方案质量核验与批准' : '负责人确认'} snapshot={snapshot} role={role} busy={busy || actionBusy} propose={act} giveReceipt={giveReceipt} /></div>
          {analysis.executionApproved && <Section title='采购、销售任务状态'><Tasks snapshot={{ ...snapshot, state: { ...state, tasks: state.tasks.filter(t => t.id !== 'T-QA') } }} role={role} busy={busy || actionBusy} propose={act} giveReceipt={giveReceipt} readOnly /></Section>}
          {(analysis.canClose || state.matter.status === 'closed') && <ReviewSummary snapshot={snapshot} sources={sources} openSource={openSource} />}
        </div>}
      </div>
      <form className='office-chat-composer' onSubmit={e => { e.preventDefault(); void submit() }}>
        <label htmlFor='office-question' className='sr-only'>业务问题</label><Textarea id='office-question' value={question} maxLength={4000} disabled={busy} onChange={e => updateSession({ question: e.target.value })} placeholder='输入问题，或描述你想进一步了解的内容…' className='min-h-20 resize-none' onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void submit() } }} />
        <div className='mt-2 flex items-center justify-between gap-3'><span className='text-xs text-muted-foreground'>{config?.mode === 'rules' ? '规则演示 · 合成数据' : '模型辅助 · 合成数据'} · 操作需人工确认</span><Button type='submit' disabled={busy || !question.trim()}>{busy ? <Loader2 className='size-4 animate-spin' /> : <ArrowUp className='size-4' />}发送问题</Button></div>
      </form>
    </div>
    <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}><DialogContent><DialogHeader><DialogTitle>希望方案如何调整？</DialogTitle><DialogDescription>保留原方案和选择记录。新建议需要重新选择、核验和批准；不会自动执行。</DialogDescription></DialogHeader><Textarea aria-label='方案修改反馈' value={feedback} maxLength={2000} onChange={e => setFeedback(e.target.value)} placeholder='例如：优先保障最早需要物料的订单，请说明还缺哪些依据。' /><DialogFooter><Button variant='outline' onClick={() => setFeedbackOpen(false)}>取消</Button><Button disabled={!feedback.trim() || busy} onClick={() => { setFeedbackOpen(false); void submit(`方案调整反馈：${feedback.trim()}。请依据现有 A/B 事实重新比较方案并回应这些约束；不能满足时说明缺口，不编造新供应商、价格或日期。原选择仅供参考，不执行任何动作。`); setFeedback('') }}>根据反馈重新分析</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
