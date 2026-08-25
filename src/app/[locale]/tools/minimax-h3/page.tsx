'use client'

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { createRuntimeId } from '@/lib/runtime-id'

type Asset = { id: string; file: File; preview?: string }
type Stage = 'idle' | 'uploading' | 'submitted' | 'running' | 'completed' | 'failed'

const RESOLUTION_OPTIONS = ['480P', '540P', '576P', '600P', '720P', '768P', '900P', '1080P']

export default function MiniMaxH3TestPage() {
  const [baseUrl, setBaseUrl] = useState('http://192.168.0.89:8188')
  const [workflowPath, setWorkflowPath] = useState('video_minimax_h3_r2v_参考图生图 (Copy).json')
  const [prompt, setPrompt] = useState('使用 <Picture 1> 作为人物和首帧参考。保持人物身份、服装与场景一致，动作自然克制，镜头缓慢推进。')
  const [duration, setDuration] = useState(5)
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [resolution, setResolution] = useState('720P')
  const [refImageSize, setRefImageSize] = useState('match')
  const [useVideoAudio, setUseVideoAudio] = useState(false)
  const [images, setImages] = useState<Asset[]>([])
  const [videos, setVideos] = useState<Asset[]>([])
  const [audios, setAudios] = useState<Asset[]>([])
  const [stage, setStage] = useState<Stage>('idle')
  const [message, setMessage] = useState('等待提交测试')
  const [promptId, setPromptId] = useState('')
  const [resultUrl, setResultUrl] = useState('')

  const tags = useMemo(() => [
    ...images.map((_, i) => `<Picture ${i + 1}>`), ...videos.map((_, i) => `<Video ${i + 1}>`),
    ...(useVideoAudio ? videos.map((_, i) => `<Audio ${i + 1}>`) : []), ...audios.map((_, i) => `<Audio ${(useVideoAudio ? videos.length : 0) + i + 1}>`),
  ], [images, videos, audios, useVideoAudio])

  useEffect(() => {
    if (!promptId || !['submitted', 'running'].includes(stage)) return
    const timer = window.setInterval(async () => {
      try {
        setStage('running'); setMessage('ComfyUI 正在执行工作流…')
        const response = await fetch(`/api/user/comfyui-minimax-test?${new URLSearchParams({ baseUrl, promptId })}`)
        const data = await response.json()
        if (data.status === 'completed') { setResultUrl(data.url); setStage('completed'); setMessage('视频生成完成'); clearInterval(timer) }
        if (data.status === 'failed') { setStage('failed'); setMessage(`模型执行失败：${JSON.stringify(data.error)}`); clearInterval(timer) }
      } catch (error) { setStage('failed'); setMessage(error instanceof Error ? error.message : '状态查询失败'); clearInterval(timer) }
    }, 3000)
    return () => clearInterval(timer)
  }, [promptId, stage, baseUrl])

  function add(kind: 'images' | 'videos' | 'audios', files: FileList | null) {
    if (!files) return
    const setter = kind === 'images' ? setImages : kind === 'videos' ? setVideos : setAudios
    const max = kind === 'images' ? 9 : 3
    const next = Array.from(files).map(file => ({ id: createRuntimeId('asset-'), file, preview: kind === 'images' ? URL.createObjectURL(file) : undefined }))
    setter(current => [...current, ...next].slice(0, max))
  }
  function move(setter: Dispatch<SetStateAction<Asset[]>>, index: number, delta: number) {
    setter(current => { const target = index + delta; if (target < 0 || target >= current.length) return current; const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next })
  }
  async function submit() {
    setStage('uploading'); setMessage('校验标签并上传素材…'); setResultUrl(''); setPromptId('')
    try {
      const form = new FormData(); form.set('baseUrl', baseUrl); form.set('workflowPath', workflowPath); form.set('prompt', prompt); form.set('duration', String(duration)); form.set('aspectRatio', aspectRatio); form.set('resolution', resolution); form.set('refImageSize', refImageSize); form.set('useVideoAudio', String(useVideoAudio))
      images.forEach(x => form.append('images', x.file)); videos.forEach(x => form.append('videos', x.file)); audios.forEach(x => form.append('audios', x.file))
      const response = await fetch('/api/user/comfyui-minimax-test', { method: 'POST', body: form }); const data = await response.json()
      if (!response.ok || !data.success) throw new Error(data.message || data.error || '提交失败')
      setPromptId(data.promptId); setStage('submitted'); setMessage(`已进入队列：${data.promptId}`)
    } catch (error) { setStage('failed'); setMessage(error instanceof Error ? error.message : '提交失败') }
  }

  const assets = (title: string, kind: 'images' | 'videos' | 'audios', items: Asset[], setter: Dispatch<SetStateAction<Asset[]>>, max: number, accept: string) => <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2 font-semibold"><AppIcon name={kind === 'images' ? 'imageEdit' : kind === 'videos' ? 'film' : 'audioWave'} className="h-[18px] w-[18px]"/> {title}</div><span className="text-xs text-slate-400">{items.length}/{max}</span></div>
    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-blue-300 bg-blue-50 py-5 text-sm font-medium text-blue-600 hover:bg-blue-100"><AppIcon name="cloudUpload" className="h-[18px] w-[18px]"/>选择文件<input className="hidden" type="file" multiple accept={accept} onChange={e => add(kind, e.target.files)}/></label>
    {kind === 'videos' && <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 text-xs font-semibold text-slate-700">参考视频声音处理</div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setUseVideoAudio(false)} className={`rounded-lg border px-2 py-2 text-xs font-medium ${!useVideoAudio ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-500'}`}>去除原声</button>
        <button type="button" onClick={() => setUseVideoAudio(true)} className={`rounded-lg border px-2 py-2 text-xs font-medium ${useVideoAudio ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-500'}`}>保留原声</button>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-slate-500">改台词、重新配音或对口型请选择“去除原声”；保留环境声或原对白请选择“保留原声”。</p>
    </div>}
    <div className="mt-3 space-y-2">{items.map((item, index) => <div key={item.id} className="flex items-center gap-2 rounded-xl bg-slate-50 p-2">{item.preview ? <img src={item.preview} alt="" className="h-12 w-12 rounded-lg object-cover"/> : <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-200"><AppIcon name={kind === 'videos' ? 'film' : 'audioWave'} className="h-[18px] w-[18px]"/></div>}<div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{item.file.name}</div><div className="text-xs text-blue-600">{kind === 'images' ? `<Picture ${index + 1}>` : kind === 'videos' ? `<Video ${index + 1}>` : `<Audio ${(useVideoAudio ? videos.length : 0) + index + 1}>`}</div></div><button onClick={() => move(setter, index, -1)}><AppIcon name="chevronUp" className="h-3.5 w-3.5"/></button><button onClick={() => move(setter, index, 1)}><AppIcon name="chevronDown" className="h-3.5 w-3.5"/></button><button className="text-red-400" onClick={() => setter(v => v.filter(x => x.id !== item.id))}><AppIcon name="trash" className="h-3.5 w-3.5"/></button></div>)}</div>
  </section>

  return <main className="min-h-screen bg-[#f4f6fa] px-6 py-8 text-slate-900"><div className="mx-auto max-w-7xl">
    <header className="mb-7 flex items-start justify-between gap-6"><div><div className="mb-2 flex items-center gap-2 text-sm font-medium text-violet-600"><AppIcon name="sparkles" className="h-[17px] w-[17px]"/>实验工具</div><h1 className="text-3xl font-bold">MiniMax H3 参考生成测试台</h1><p className="mt-2 text-sm text-slate-500">运行时动态组装参考素材节点，不再依赖工作流中的示例文件。</p></div><div className={`max-w-md rounded-full px-4 py-2 text-sm ${stage === 'failed' ? 'bg-red-100 text-red-600' : stage === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{message}</div></header>
    <div className="grid gap-6 lg:grid-cols-[1fr_350px]"><div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="mb-5 text-lg font-semibold">1. 工作流参数</h2><div className="grid gap-4 md:grid-cols-2"><Field label="ComfyUI 地址" value={baseUrl} onChange={setBaseUrl}/><Field label="工作流路径" value={workflowPath} onChange={setWorkflowPath}/></div><div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Select label="时长" value={String(duration)} values={['3','5','6','10','15']} onChange={v=>setDuration(Number(v))}/><Select label="画面比例" value={aspectRatio} values={['16:9','9:16','1:1']} onChange={setAspectRatio}/><Select label="输出清晰度" value={resolution} values={RESOLUTION_OPTIONS} onChange={setResolution}/><Select label="参考精度" value={refImageSize} values={['match','max']} onChange={setRefImageSize}/></div><p className="mt-3 text-xs text-slate-500">输出清晰度会设置工作流 User inputs 中的百万像素；LoRA、采样步数和采样器保持工作流文件中的原始配置。</p></section>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="mb-3 flex justify-between"><h2 className="text-lg font-semibold">2. MiniMax 提示词</h2><span className="text-xs text-slate-400">{prompt.length}/4000</span></div><textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows={8} className="w-full rounded-xl border border-slate-200 p-4 text-sm leading-6 outline-none focus:border-violet-400"/><div className="mt-3 flex flex-wrap gap-2">{tags.map(tag=><button key={tag} onClick={()=>setPrompt(p=>`${p} ${tag}`)} className="rounded-full bg-violet-50 px-3 py-1.5 text-xs text-violet-700">{tag}</button>)}</div></section>
      <div className="grid gap-5 xl:grid-cols-3">{assets('参考图片','images',images,setImages,9,'image/*')}{assets('参考视频','videos',videos,setVideos,3,'video/*')}{assets('参考音频','audios',audios,setAudios,3,'audio/*')}</div>
    </div><aside><section className="sticky top-6 rounded-2xl bg-slate-950 p-6 text-white shadow-xl"><h2 className="text-lg font-semibold">提交预览</h2><div className="mt-5 space-y-3 text-sm text-slate-300"><Row name="参考图片" value={images.length}/><Row name="参考视频" value={videos.length}/><Row name="视频原声" value={useVideoAudio ? '保留' : '去除'}/><Row name="参考音频" value={audios.length}/><Row name="生成时长" value={`${duration} 秒`}/><Row name="输出清晰度" value={resolution}/><Row name="生成参数" value="使用工作流原始配置"/></div><button disabled={['uploading','submitted','running'].includes(stage)} onClick={submit} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 py-3.5 font-semibold disabled:opacity-50"><AppIcon name="play" className="h-[18px] w-[18px]"/>{stage === 'uploading' ? '上传中…' : ['submitted','running'].includes(stage) ? '生成中…' : '提交测试'}</button>{promptId && <div className="mt-4 break-all rounded-xl bg-slate-900 p-3 text-xs text-slate-400">任务 ID：{promptId}</div>}{resultUrl && <video src={resultUrl} controls className="mt-4 w-full rounded-xl"/>}</section></aside></div>
  </div></main>
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="text-sm font-medium">{label}<input value={value} onChange={e=>onChange(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-blue-400"/></label> }
function Select({ label, value, values, onChange }: { label: string; value: string; values: string[]; onChange: (value: string) => void }) { return <label className="text-sm font-medium">{label}<select value={value} onChange={e=>onChange(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3">{values.map(v=><option key={v}>{v}</option>)}</select></label> }
function Row({ name, value }: { name: string; value: string | number }) { return <div className="flex justify-between"><span>{name}</span><b className="text-white">{value}</b></div> }
