import { useState } from 'react'
import { AlertCircle, ArrowRight, CheckCircle2, Clock3 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { OfficeGraph } from './graph'
import { Section, Sources, Status } from './shared'
import {
  roleNames,
  showValue,
  type Action,
  type Role,
  type Snapshot,
  type Source,
  type Task,
} from './types'

export type BusinessProps = {
  snapshot: Snapshot
  role: Role
  busy: boolean
  sources: Source[]
  propose: (action: Action) => void
  openSource: (source: Source) => void
  giveReceipt: (task: Task) => void
  ask: (question: string) => void
  viewMatter: () => void
}

function receiptText(receipt: unknown) {
  return showValue(
    receipt && typeof receipt === 'object' && 'evidence' in receipt
      ? receipt.evidence
      : receipt
  )
}
function taskLabel(task: Task, closed: boolean) {
  if (task.id !== 'T-QA' && task.receipt && !closed) return '已提交，待复核'
  if (task.status === 'delivery_failed') return '待处理 · 通知发送失败'
  if (task.status === 'delivered') return '待接收'
  if (task.status === 'accepted') return '已接收，待开始'
  if (task.status === 'in_progress') return '处理中'
  if (task.qualityResult === 'rejected') return '核验不通过'
  if (task.status === 'completed')
    return task.id === 'T-QA' ? '核验通过' : '已完成'
  if (task.status === 'awaiting_review') return '已提交，待复核'
  return '待发送'
}
function situation({ state, analysis }: Snapshot) {
  const qa = state.tasks.find((task) => task.id === 'T-QA')
  const quality = state.suppliers.find(
    (supplier) => supplier.id === 'B'
  )?.quality
  if (state.matter.status === 'closed')
    return {
      label: '已关闭',
      waiting: '各岗位处理完成，负责人已复核',
      detail: '本次办公事项已关闭，决定、核验凭据和部门回执已留档。',
    }
  if (analysis.executionApproved) {
    if (analysis.canClose)
      return {
        label: '待负责人复核',
        waiting: '业务负责人 · 复核两份回执',
        detail: '采购、销售均已提交回执，等待最终复核。',
      }
    const missing = analysis.missingReceipts.map((id) =>
      id === 'T-PUR' ? '采购经办' : id === 'T-SALES' ? '销售经办' : id
    )
    return {
      label: state.tasks.some((task) => task.status === 'pending_delivery')
        ? '待发送部门任务'
        : '部门执行中',
      waiting: state.tasks.some((task) => task.status === 'pending_delivery')
        ? '业务负责人 · 确认并发送任务'
        : missing.join('、') + ' · 接收任务并提交处理回执',
      detail:
        '负责人已确认执行方案，部门回执 ' +
        (2 - analysis.missingReceipts.length) +
        '/2。',
    }
  }
  if (state.matter.planSelection?.supplierId === 'A')
    return {
      label: '待确认沿用 A',
      waiting: '业务负责人 · 确认到料风险与跟进安排',
      detail: analysis.nextStep,
    }
  if (!state.matter.planSelection && !qa)
    return {
      label: '待选择方案',
      waiting: '采购经办或业务负责人 · 比较并选择 A/B',
      detail: analysis.nextStep,
    }
  if (quality === 'rejected')
    return {
      label: '方案质量核验不通过',
      waiting: '采购经办或业务负责人 · 重新发起核验',
      detail: '本轮 B 路径不可执行，当前继续由 A 供货。',
    }
  if (
    qa?.status === 'completed' &&
    qa.qualityResult === 'approved' &&
    quality === 'approved'
  )
    return {
      label: '待负责人确认',
      waiting: '业务负责人 · 决定是否切换',
      detail: 'B 已通过方案质量核验，供应方案切换仍待批准。',
    }
  if (qa?.status === 'delivery_failed')
    return {
      label: '核验通知发送失败',
      waiting: '质量负责人、采购经办或业务负责人 · 重试发送',
      detail: '核验任务已创建，通知尚未送达。',
    }
  if (qa)
    return {
      label: '待方案质量核验',
      waiting: '质量负责人 · 提交核验结果',
      detail: '供应商 B 资格待核验，当前有效方案仍为 A。',
    }
  return {
    label: '待方案核对',
    waiting: '业务负责人或采购经办 · 核对方案并发起核验',
    detail: '已关联订单与到料要求；切换 B 前还需方案质量核验与负责人批准。',
  }
}
function Receipt({ task }: { task: Task }) {
  const history =
    (
      task as Task & {
        history?: {
          receipt?: unknown
          qualityResult?: string
          completedAt?: string
        }[]
      }
    ).history ?? []
  return (
    <div className='space-y-3 text-sm'>
      {!!task.receipt && (
        <details>
          <summary className='cursor-pointer underline decoration-border underline-offset-4'>
            查看回执
          </summary>
          {!!task.receipt && typeof task.receipt === 'object' && (
            <p className='mt-2 text-muted-foreground'>
              {roleNames[(task.receipt as { actor: Role }).actor]} ·{' '}
              {new Date((task.receipt as { at: string }).at).toLocaleString(
                'zh-CN'
              )}
            </p>
          )}
          {task.qualityResult && (
            <p className='mt-3 font-medium'>
              核验结论：{task.qualityResult === 'approved' ? '通过' : '不通过'}
            </p>
          )}
          <p className='mt-2 break-words whitespace-pre-wrap text-muted-foreground'>
            {receiptText(task.receipt)}
          </p>
        </details>
      )}
      {history.length > 0 && (
        <details>
          <summary className='cursor-pointer text-muted-foreground'>
            历史核验 · {history.length} 次
          </summary>
          <div className='mt-3 space-y-3'>
            {history.map((item, index) => (
              <div key={index} className='border-l-2 pl-3'>
                <p>
                  第 {index + 1} 次 ·{' '}
                  {item.qualityResult === 'approved'
                    ? '通过'
                    : item.qualityResult === 'rejected'
                      ? '不通过'
                      : '未记录结论'}
                </p>
                <p className='mt-1 break-words whitespace-pre-wrap text-muted-foreground'>
                  {receiptText(item.receipt)}
                </p>
                {item.completedAt && (
                  <p className='mt-1 text-xs text-muted-foreground'>
                    {new Date(item.completedAt).toLocaleString('zh-CN')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
function TaskAction({
  task,
  snapshot,
  role,
  propose,
  giveReceipt,
  busy,
}: Pick<
  BusinessProps,
  'snapshot' | 'role' | 'propose' | 'giveReceipt' | 'busy'
> & { task: Task }) {
  if (snapshot.state.matter.status === 'closed') return null
  if (
    task.status === 'delivery_failed' &&
    (task.assignee === role || ['lead', 'procurement'].includes(role))
  )
    return (
      <Button
        disabled={busy || task.attempts >= 3}
        onClick={() => propose({ type: 'retry_delivery', taskId: task.id })}
      >
        {task.attempts >= 3 ? '已到重试上限' : '重试发送'}
      </Button>
    )
  if (task.assignee !== role || task.receipt) return null
  if (task.status === 'delivered')
    return (
      <Button
        disabled={busy}
        onClick={() => propose({ type: 'accept_task', taskId: task.id })}
      >
        确认接收任务
      </Button>
    )
  if (task.status === 'accepted')
    return (
      <Button
        disabled={busy}
        onClick={() => propose({ type: 'start_task', taskId: task.id })}
      >
        开始处理
      </Button>
    )
  if (task.status === 'in_progress')
    return (
      <Button disabled={busy} onClick={() => giveReceipt(task)}>
        {task.id === 'T-QA'
          ? '提交核验结果'
          : task.id === 'T-PUR'
            ? '提交采购回执'
            : '提交销售回执'}
      </Button>
    )
  return null
}
export function BusinessActions({
  snapshot,
  role,
  propose,
  busy,
}: Pick<BusinessProps, 'snapshot' | 'role' | 'propose' | 'busy'>) {
  const { state, analysis } = snapshot
  if (state.matter.status === 'closed') return null
  const qa = state.tasks.find((task) => task.id === 'T-QA')
  const quality = state.suppliers.find(
    (supplier) => supplier.id === 'B'
  )?.quality
  const selectedPlan =
    state.matter.planSelection?.supplierId ??
    (qa || state.matter.supplierId === 'B' ? 'B' : undefined)
  if (analysis.canClose)
    return role === 'lead' ? (
      <Button disabled={busy} onClick={() => propose({ type: 'close_matter' })}>
        复核并关闭事项
      </Button>
    ) : null
  if (analysis.executionApproved)
    return role === 'lead' &&
      state.tasks.some(
        (task) =>
          ['T-PUR', 'T-SALES'].includes(task.id) &&
          task.status === 'pending_delivery'
      ) ? (
      <Button disabled={busy} onClick={() => propose({ type: 'send_tasks' })}>
        确认并发送任务
      </Button>
    ) : null
  if (!selectedPlan)
    return (
      <p className='text-sm text-muted-foreground'>
        请先比较并选择处理方案，补充理由可选。
      </p>
    )
  if (selectedPlan === 'A')
    return role === 'lead' ? (
      <Button
        disabled={busy}
        onClick={() => propose({ type: 'approve_keep_a' })}
      >
        确认沿用 A 并安排跟进
      </Button>
    ) : (
      <p className='text-sm text-muted-foreground'>
        等待业务负责人确认沿用 A 及跟进安排。
      </p>
    )
  if (
    state.matter.supplierId === 'A' &&
    (!qa || (qa.status === 'completed' && quality === 'rejected')) &&
    ['lead', 'procurement'].includes(role)
  )
    return (
      <Button
        disabled={busy}
        onClick={() => propose({ type: 'request_quality' })}
      >
        {qa ? '重新发起方案质量核验' : '准备方案质量核验'}
      </Button>
    )
  if (role !== 'lead') return null
  if (
    state.matter.supplierId === 'A' &&
    quality === 'approved' &&
    qa?.status === 'completed' &&
    qa.qualityResult === 'approved'
  )
    return (
      <Button
        disabled={busy}
        onClick={() => propose({ type: 'approve_switch' })}
      >
        批准切换供应商 B
      </Button>
    )
  if (analysis.canClose)
    return (
      <Button disabled={busy} onClick={() => propose({ type: 'close_matter' })}>
        复核并关闭事项
      </Button>
    )
  return null
}
export function RoleAction(
  props: Pick<
    BusinessProps,
    'snapshot' | 'role' | 'busy' | 'propose' | 'giveReceipt'
  > & { title?: string; viewMatter?: () => void }
) {
  const { state, analysis } = props.snapshot
  const current = situation(props.snapshot)
  const closed = state.matter.status === 'closed'
  const own = state.tasks.find((task) => task.assignee === props.role)
  const failed = state.tasks.find(
    (task) =>
      task.status === 'delivery_failed' &&
      (task.assignee === props.role ||
        ['lead', 'procurement'].includes(props.role))
  )
  const actionTask = own && !own.receipt ? own : failed
  return (
    <Section
      title={props.title || '我的下一步'}
      aside={<Badge variant='outline'>{roleNames[props.role]}</Badge>}
    >
      <div className='space-y-4'>
        {closed ? (
          <div className='flex items-start gap-2 text-sm'>
            <CheckCircle2 className='mt-0.5 size-4 shrink-0 text-emerald-600' />
            <p>事项已关闭，可查看处理结果和凭据。</p>
          </div>
        ) : actionTask ? (
          <>
            <p className='font-medium'>{actionTask.title}</p>
            <p className='text-sm text-muted-foreground'>
              {actionTask.id} · {taskLabel(actionTask, closed)}
            </p>
            {actionTask.status === 'delivery_failed' ? (
              <p className='text-sm leading-6 text-destructive'>
                通知发送失败，任务尚未开始。已尝试 {actionTask.attempts} 次
                {actionTask.attempts >= 3 ? '，请检查失败原因。' : '。'}
              </p>
            ) : (
              <p className='text-sm leading-6 text-muted-foreground'>
                {actionTask.id === 'T-QA'
                  ? '核验供应商 B 方案质量，并提交结论与凭据。'
                  : actionTask.id === 'T-PUR'
                    ? '依据生效决定确认采购安排，提交处理说明与凭据。'
                    : '依据生效决定同步关联订单交期信息，提交处理说明与凭据。'}
              </p>
            )}
            <TaskAction {...props} task={actionTask} />
          </>
        ) : (
          <>
            <p className='text-sm leading-6'>
              {own?.receipt
                ? '你的' +
                  (own.id === 'T-QA' ? '核验结果' : '处理回执') +
                  '已提交。'
                : current.detail}
            </p>
            <p className='text-sm leading-6 text-muted-foreground'>
              {current.waiting}
            </p>
            <BusinessActions {...props} />
          </>
        )}
        {props.viewMatter && (
          <div>
            <Button
              variant='outline'
              disabled={props.busy}
              onClick={props.viewMatter}
            >
              {closed
                ? '查看处理记录'
                : state.tasks.some((task) => task.id === 'T-QA') &&
                    state.matter.supplierId === 'A'
                  ? '查看核验任务'
                  : '查看事项与任务'}
              <ArrowRight className='size-4' />
            </Button>
          </div>
        )}
        {own && <Receipt task={own} />}
        {!closed &&
          props.role === 'lead' &&
          analysis.executionApproved &&
          !analysis.canClose && (
            <details className='border-t pt-4 text-sm'>
              <summary className='cursor-pointer font-medium'>
                查看关闭条件
              </summary>
              <ul className='mt-3 space-y-2 text-muted-foreground'>
                <li>有效决定：{analysis.effectiveDecisionId}</li>
                <li>
                  方案核验条件：
                  {state.matter.supplierId === 'A'
                    ? '沿用 A 已批准资格'
                    : state.suppliers.find((supplier) => supplier.id === 'B')
                          ?.quality === 'approved'
                      ? '已通过'
                      : '未通过'}
                </li>
                {['T-PUR', 'T-SALES'].map((id) => (
                  <li key={id}>
                    {id === 'T-PUR' ? '采购回执' : '销售回执'}：
                    {analysis.missingReceipts.includes(id)
                      ? '待提交'
                      : '已提交'}
                  </li>
                ))}
              </ul>
            </details>
          )}
      </div>
    </Section>
  )
}
export function Orders({ snapshot }: { snapshot: Snapshot }) {
  return (
    <div className='overflow-x-auto'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>关联订单</TableHead>
            <TableHead>最迟到料</TableHead>
            <TableHead>当前方案到料</TableHead>
            <TableHead>判断</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {snapshot.analysis.orders.map((order) => (
            <TableRow key={order.id}>
              <TableCell className='font-medium'>{order.id}</TableCell>
              <TableCell>D{order.requiredDay}</TableCell>
              <TableCell>D{order.arrivalDay}</TableCell>
              <TableCell>
                {order.atRisk ? (
                  <Badge variant='destructive'>晚 {order.lateDays} 天</Badge>
                ) : (
                  <span className='text-sm text-muted-foreground'>
                    满足到料要求
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
export function Tasks(
  props: Pick<
    BusinessProps,
    'snapshot' | 'role' | 'propose' | 'giveReceipt' | 'busy'
  > & { readOnly?: boolean }
) {
  const { snapshot, readOnly } = props
  const closed = snapshot.state.matter.status === 'closed'
  if (!snapshot.state.tasks.length)
    return <p className='text-sm text-muted-foreground'>尚未发起任务。</p>
  return (
    <div className='overflow-x-auto'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>任务</TableHead>
            <TableHead>负责岗位</TableHead>
            <TableHead>处理状态</TableHead>
            <TableHead>通知状态</TableHead>
            {!readOnly && <TableHead className='text-right'>操作</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {snapshot.state.tasks.map((task) => (
            <TableRow key={task.id}>
              <TableCell className='min-w-48'>
                <p className='font-medium'>{task.title}</p>
                <p className='mt-1 mb-2 text-xs text-muted-foreground'>
                  {task.id}
                </p>
                <Receipt task={task} />
              </TableCell>
              <TableCell className='whitespace-nowrap'>
                {roleNames[task.assignee]}
              </TableCell>
              <TableCell className='whitespace-nowrap'>
                <Badge
                  variant={
                    task.status === 'delivery_failed' ||
                    task.qualityResult === 'rejected'
                      ? 'destructive'
                      : 'secondary'
                  }
                >
                  {taskLabel(task, closed)}
                </Badge>
              </TableCell>
              <TableCell className='text-sm text-muted-foreground'>
                {task.status === 'delivery_failed' ? (
                  <span className='text-destructive'>
                    发送失败 · {task.attempts} 次
                  </span>
                ) : task.status === 'pending_delivery' ? (
                  '待发送'
                ) : (
                  '已送达'
                )}
              </TableCell>
              {!readOnly && (
                <TableCell>
                  <div className='flex justify-end'>
                    <TaskAction {...props} task={task} />
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
function matterCategory(snapshot: Snapshot) {
  return snapshot.state.matter.status === 'closed'
    ? 'closed'
    : snapshot.state.matter.planSelection || snapshot.state.tasks.length
      ? 'processing'
      : 'warning'
}
export function Home(props: BusinessProps) {
  const { snapshot, viewMatter, ask, role } = props
  const { state, analysis } = snapshot
  const category = matterCategory(snapshot)
  const [filter, setFilter] = useState('all')
  const current = situation(snapshot)
  const closed = category === 'closed'
  const ownTasks = closed
    ? []
    : state.tasks.filter(
        (task) =>
          task.assignee === role &&
          !task.receipt &&
          task.status !== 'pending_delivery'
      )
  const pendingSend = state.tasks.some(
    (task) => task.status === 'pending_delivery'
  )
  const managementTodo =
    !closed &&
    (analysis.executionApproved
      ? role === 'lead' && (analysis.canClose || pendingSend)
      : !state.matter.planSelection
        ? ['lead', 'procurement'].includes(role)
        : state.matter.planSelection.supplierId === 'A'
          ? role === 'lead'
          : !state.tasks.length ||
              state.tasks.some(
                (task) =>
                  task.id === 'T-QA' && task.qualityResult === 'rejected'
              )
            ? ['lead', 'procurement'].includes(role)
            : state.tasks.some(
                (task) =>
                  task.id === 'T-QA' && task.qualityResult === 'approved'
              ) && role === 'lead')
  return (
    <div className='space-y-6'>
      <p className='text-muted-foreground'>
        关注异常事项，协同各岗位完成确认、执行与回执。
      </p>
      <div className='grid grid-cols-3 gap-3'>
        {[
          ['warning', '预警'],
          ['processing', '处理中'],
          ['closed', '已办结'],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setFilter(filter === id ? 'all' : id)}
            className={
              'rounded-xl border bg-card p-4 text-left sm:p-6 ' +
              (filter === id ? 'border-primary ring-1 ring-primary' : '')
            }
          >
            <p className='text-sm text-muted-foreground'>{label}</p>
            <p className='mt-3 text-3xl font-semibold tabular-nums'>
              {category === id ? 1 : 0}
            </p>
            <p className='mt-2 text-xs text-muted-foreground'>协同事项</p>
          </button>
        ))}
      </div>
      <div className='grid items-start gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]'>
        <div className='space-y-6'>
          <Section
            title='关注事项'
            aside={
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setFilter('all')}
              >
                全部事项
              </Button>
            }
          >
            {filter !== 'all' && filter !== category ? (
              <p className='py-8 text-center text-muted-foreground'>
                此分类暂无事项。
              </p>
            ) : (
              <div className='space-y-4'>
                <button
                  className='flex w-full flex-wrap items-center justify-between gap-3 text-left'
                  onClick={viewMatter}
                >
                  <div>
                    <h3 className='text-lg font-semibold'>
                      {state.matter.title}
                    </h3>
                    <p className='mt-2 text-sm text-muted-foreground'>
                      {state.matter.id} · 物料 {state.matter.materialId}
                    </p>
                  </div>
                  <Badge
                    variant={category === 'warning' ? 'destructive' : 'outline'}
                  >
                    {closed ? '已办结' : current.label}
                  </Badge>
                </button>
                <p className='border-y py-4 text-sm leading-7'>
                  {current.detail}
                </p>
                <p className='text-sm text-muted-foreground'>
                  {current.waiting}
                </p>
                <div className='flex flex-wrap gap-3'>
                  <Button
                    onClick={() =>
                      ask(
                        closed
                          ? '这件事现在处理到哪里了？'
                          : '供应商 A 延期会影响哪些订单？'
                      )
                    }
                  >
                    {closed ? '查询办结记录' : '继续处理'}
                    <ArrowRight className='size-4' />
                  </Button>
                  <Button variant='outline' onClick={viewMatter}>
                    查看事项详情
                  </Button>
                </div>
              </div>
            )}
          </Section>
          <Section
            title='关联订单与到料风险'
            aside={
              <Badge variant='outline'>
                {analysis.riskCount} / {analysis.linkedCount} 条有风险
              </Badge>
            }
          >
            <Orders snapshot={snapshot} />
            <p className='mt-4 text-sm text-muted-foreground'>
              按当前有效供应方案计算。办公事项办结不代表实物到货、生产完成或订单交付。
            </p>
          </Section>
        </div>
        <div className='space-y-6'>
          <Section
            title='我的待办'
            aside={
              <Badge variant='outline'>
                {roleNames[role]} · {ownTasks.length + (managementTodo ? 1 : 0)}
              </Badge>
            }
          >
            {!ownTasks.length && !managementTodo && (
              <p className='py-6 text-sm text-muted-foreground'>
                当前岗位暂无待办。可查看事项进度或已提交的处理记录。
              </p>
            )}
            {managementTodo && (
              <div className='space-y-3 rounded-lg border p-4'>
                <p className='font-medium'>{current.label}</p>
                <p className='text-sm text-muted-foreground'>
                  {state.matter.id} · {roleNames[role]}
                </p>
                <p className='text-sm leading-6'>{current.waiting}</p>
                <Button
                  variant='outline'
                  onClick={() => ask('这件事现在处理到哪里了？')}
                >
                  进入办理
                </Button>
              </div>
            )}
            {ownTasks.map((task) => (
              <div
                key={task.id}
                className='mb-3 space-y-3 rounded-lg border p-4'
              >
                <p className='font-medium'>{task.title}</p>
                <p className='text-sm text-muted-foreground'>
                  {state.matter.id} · {task.id} · {roleNames[task.assignee]}
                </p>
                <Badge variant='outline'>{taskLabel(task, closed)}</Badge>
                <p className='text-sm leading-6'>
                  {task.id === 'T-QA'
                    ? '须在切换批准前完成核验'
                    : '关联决定 ' +
                      analysis.effectiveDecisionId +
                      '；请反馈处理说明及凭据'}
                </p>
                <Button variant='outline' onClick={() => ask('')}>
                  进入办理
                </Button>
              </div>
            ))}
          </Section>
          <Section title='最近处理记录'>
            {state.events.length ? (
              <ol className='space-y-4'>
                {state.events
                  .slice(-3)
                  .reverse()
                  .map((event) => (
                    <li key={event.id} className='border-l-2 pl-3'>
                      <p className='line-clamp-3 text-sm leading-6'>
                        {event.message}
                      </p>
                      <p className='mt-1 text-xs text-muted-foreground'>
                        {roleNames[event.actor as Role]} ·{' '}
                        {new Date(event.at).toLocaleString('zh-CN')}
                      </p>
                    </li>
                  ))}
              </ol>
            ) : (
              <div className='flex gap-3 text-sm leading-7'>
                <AlertCircle className='mt-1 size-4 shrink-0' />
                <p>
                  已收到供应商延期通知。请选择关注事项，开始核对影响与处理方案。
                </p>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}
export function Paths({ snapshot }: { snapshot: Snapshot }) {
  const { state, analysis } = snapshot
  return (
    <Section title='到料方案比较'>
      <div className='grid gap-4 md:grid-cols-2'>
        {analysis.options.map((option) => {
          const selected = state.matter.supplierId === option.supplierId
          return (
            <div
              key={option.supplierId}
              className={
                'rounded-lg border p-4 ' +
                (selected ? 'border-foreground/25 bg-muted/20' : '')
              }
            >
              <div className='flex items-center justify-between gap-3'>
                <h3 className='text-sm font-semibold'>{option.name}</h3>
                <Badge variant={selected ? 'default' : 'outline'}>
                  {selected
                    ? '当前执行'
                    : option.supplierId === 'B'
                      ? '候选方案'
                      : '原方案'}
                </Badge>
              </div>
              {state.matter.planSelection?.supplierId === option.supplierId && (
                <p className='mt-2 text-xs font-medium'>
                  已选择此处理方案
                  {!analysis.executionApproved
                    ? ' · 待完成前置条件与负责人确认'
                    : ''}
                </p>
              )}
              <p className='mt-4 text-sm'>
                预计{' '}
                <strong className='text-xl tabular-nums'>
                  D{option.arrivalDay}
                </strong>{' '}
                到料{' '}
                <span className='ml-3 text-muted-foreground'>
                  {option.riskCount} 条风险订单
                </span>
              </p>
              <div className='mt-4 space-y-2 border-t pt-4'>
                {analysis.orders.map((order) => (
                  <div
                    key={order.id}
                    className='flex flex-wrap justify-between gap-2 text-sm'
                  >
                    <span>
                      {order.id} · 最迟 D{order.requiredDay}
                    </span>
                    <span
                      className={
                        option.arrivalDay > order.requiredDay
                          ? 'font-medium text-destructive'
                          : 'text-muted-foreground'
                      }
                    >
                      {option.arrivalDay > order.requiredDay
                        ? '晚 ' +
                          (option.arrivalDay - order.requiredDay) +
                          ' 天'
                        : '满足到料要求'}
                    </span>
                  </div>
                ))}
              </div>
              <div className='mt-4 space-y-2 border-t pt-4 text-sm'>
                <p>
                  方案核验条件：
                  {option.quality === 'approved'
                    ? '已通过'
                    : option.quality === 'rejected'
                      ? '未通过'
                      : '待核验'}
                </p>
                <p className='text-muted-foreground'>
                  {selected
                    ? '当前依据 ' + analysis.effectiveDecisionId + ' 执行'
                    : option.supplierId === 'B'
                      ? option.quality === 'rejected'
                        ? '本轮质量条件不满足，不能切换。'
                        : option.quality === 'approved'
                          ? '质量条件已满足，仍需负责人批准。'
                          : '方案质量核验通过并经负责人批准后才可切换。'
                      : '原有效决定已被替代。'}
                </p>
              </div>
            </div>
          )
        })}
      </div>
      <p className='mt-4 text-xs leading-5 text-muted-foreground'>
        比较范围：到料时间、方案核验条件、批准条件；未包含价格、产能及运输条件。
      </p>
    </Section>
  )
}
export function Matter(props: BusinessProps) {
  const { snapshot, sources, openSource, ask } = props
  const { state, analysis } = snapshot
  const current = situation(snapshot)
  const supplierA = state.suppliers.find((item) => item.id === 'A')
  const effective = state.decisions.find((item) => item.status === 'effective')
  return (
    <div className='office-matter space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-6'>
        <div>
          <h2 className='text-2xl font-semibold'>{state.matter.title}</h2>
          <p className='mt-3 text-sm text-muted-foreground'>
            {state.matter.id} · 物料 {state.matter.materialId} ·
            日期采用相对演示日 D1–D9
          </p>
        </div>
        <Badge variant='outline'>
          {matterCategory(snapshot) === 'closed' ? '已办结' : current.label}
        </Badge>
        <p className='w-full text-base leading-7'>{current.detail}</p>
      </div>
      <Section title='当前情况与影响'>
        <p className='mb-4 text-base leading-7'>
          供应商 A 的预计到料日由 D{supplierA?.originalDay} 延至 D
          {supplierA?.arrivalDay}；当前采用 {state.matter.supplierId} 方案，
          {analysis.linkedCount} 条关联订单中有{' '}
          <strong className={analysis.riskCount ? 'text-destructive' : ''}>
            {analysis.riskCount} 条到料风险
          </strong>
          。
        </p>
        <Orders snapshot={snapshot} />
        <div className='mt-4'>
          <Sources
            sources={sources.filter((s) =>
              ['DOC-NOTICE', 'DOC-LEDGER'].includes(s.id)
            )}
            open={openSource}
          />
        </div>
      </Section>
      <Section title='方案与决定'>
        <div className='grid gap-5 md:grid-cols-3'>
          {[
            [
              '选择意向',
              state.matter.planSelection
                ? `已选 ${state.matter.planSelection.supplierId}`
                : '尚未选择',
            ],
            [
              '负责人批准',
              analysis.executionApproved
                ? `已批准 ${state.matter.supplierId}`
                : '尚未批准',
            ],
            ['当前有效决定', analysis.effectiveDecisionId],
          ].map(([label, value]) => (
            <div key={label}>
              <p className='text-sm text-muted-foreground'>{label}</p>
              <p className='mt-2 text-lg font-semibold'>{value}</p>
            </div>
          ))}
        </div>
        <p className='mt-5 border-t pt-4 text-base leading-7'>
          {effective?.text}
        </p>
        {state.matter.planSelection && (
          <p className='mt-3 text-sm leading-7'>
            选择依据：{state.matter.planSelection.reason}
          </p>
        )}
        <div className='mt-4'>
          <Sources
            sources={sources.filter((s) =>
              [
                effective?.sourceId,
                'DOC-PLAN-SELECTION',
                'DOC-KEEP-A',
                'QA-B-001',
              ].includes(s.id)
            )}
            open={openSource}
          />
        </div>
        <details className='mt-5 border-t pt-4'>
          <summary className='cursor-pointer font-medium'>
            比较方案与历史决定
          </summary>
          <div className='mt-4 space-y-4'>
            <Paths snapshot={snapshot} />
            {state.decisions
              .filter((d) => d.id !== effective?.id)
              .map((d) => (
                <div key={d.id} className='rounded-lg border p-4'>
                  <p className='flex items-center gap-3'>
                    {d.id}
                    <Status value={d.status} />
                  </p>
                  <p className='my-3 text-sm leading-7'>{d.text}</p>
                  <Sources
                    sources={sources.filter((s) => s.id === d.sourceId)}
                    open={openSource}
                  />
                </div>
              ))}
          </div>
        </details>
      </Section>
      <Section
        title='执行与回执'
        aside={<Badge variant='outline'>{current.label}</Badge>}
      >
        <p className='mb-4 text-base leading-7'>{current.waiting}</p>
        {state.tasks.length ? (
          <Tasks {...props} readOnly />
        ) : (
          <p className='text-sm text-muted-foreground'>
            尚未发起任务；选择方案后按前置条件继续办理。
          </p>
        )}
        {state.matter.review && (
          <p className='mt-4 rounded-md bg-muted p-4 text-sm leading-7'>
            {roleNames[state.matter.review.reviewedBy]} 于{' '}
            {new Date(state.matter.review.reviewedAt).toLocaleString('zh-CN')}{' '}
            复核两份回执并关闭办公事项。关闭不代表原料已到货、生产完成或订单已交付。
          </p>
        )}
      </Section>
      <details className='rounded-xl border p-5'>
        <summary className='cursor-pointer text-base font-semibold'>
          来源与处理记录 · {state.events.length} 条
        </summary>
        <div className='mt-5 space-y-5'>
          <Sources
            sources={sources.filter((s) => s.id !== 'DEMO-STATE')}
            open={openSource}
          />
          {state.events.length ? (
            <ol className='space-y-5'>
              {[...state.events].reverse().map((event) => (
                <li key={event.id} className='flex gap-3'>
                  <Clock3 className='mt-1 size-4 shrink-0 text-muted-foreground' />
                  <div>
                    <p className='text-sm leading-7'>{event.message}</p>
                    <p className='mt-1 text-sm text-muted-foreground'>
                      {roleNames[event.actor as Role]} ·{' '}
                      {new Date(event.at).toLocaleString('zh-CN')}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className='text-sm text-muted-foreground'>尚无处理记录。</p>
          )}
        </div>
      </details>
      <details className='rounded-xl border p-5'>
        <summary className='cursor-pointer text-base font-semibold'>
          高级视图 · 业务关系 / 业务对象 / 模型结构
        </summary>
        <div className='mt-5'>
          <OfficeGraph graph={snapshot.graph} openSource={openSource} />
        </div>
      </details>
      <Button className='h-12 w-full text-base' onClick={() => ask('')}>
        返回业务助手继续办理
        <ArrowRight className='size-4' />
      </Button>
    </div>
  )
}

export function MatterList({
  snapshot,
  viewMatter,
}: Pick<BusinessProps, 'snapshot' | 'viewMatter'>) {
  const [query, setQuery] = useState(
    () => sessionStorage.getItem('office-matter-query') || ''
  )
  const [filter, setFilter] = useState(
    () => sessionStorage.getItem('office-matter-filter') || 'all'
  )
  const category = matterCategory(snapshot)
  const matches =
    (filter === 'all' || filter === category) &&
    `${snapshot.state.matter.id} ${snapshot.state.matter.title} ${snapshot.state.matter.materialId}`
      .toLowerCase()
      .includes(query.toLowerCase())
  return (
    <Section title='事项列表'>
      <div className='mb-5 flex flex-wrap gap-3'>
        <Input
          aria-label='搜索事项'
          className='max-w-sm'
          placeholder='搜索事项名称、编号或物料'
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            sessionStorage.setItem('office-matter-query', e.target.value)
          }}
        />
        <select
          aria-label='事项状态筛选'
          className='rounded-md border bg-background px-3 py-2 text-sm'
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value)
            sessionStorage.setItem('office-matter-filter', e.target.value)
          }}
        >
          <option value='all'>全部状态</option>
          <option value='warning'>预警</option>
          <option value='processing'>处理中</option>
          <option value='closed'>已办结</option>
        </select>
      </div>
      {matches ? (
        <button
          className='flex w-full flex-wrap items-center justify-between gap-4 rounded-lg border p-5 text-left hover:bg-muted'
          onClick={viewMatter}
        >
          <div>
            <p className='font-semibold'>{snapshot.state.matter.title}</p>
            <p className='mt-2 text-sm text-muted-foreground'>
              {snapshot.state.matter.id} · {snapshot.state.matter.materialId}
            </p>
          </div>
          <Badge variant='outline'>
            {category === 'closed'
              ? '已办结'
              : category === 'warning'
                ? '预警'
                : '处理中'}
          </Badge>
          <ArrowRight className='size-4' />
        </button>
      ) : (
        <p className='py-10 text-center text-muted-foreground'>
          没有符合筛选条件的事项。
        </p>
      )}
      <p className='mt-4 text-sm text-muted-foreground'>
        当前演示包含 1 条供应商交期变更事项；办结记录在此保留。
      </p>
    </Section>
  )
}
