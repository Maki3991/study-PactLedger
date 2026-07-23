import { useEffect } from 'react'
import { AlertTriangle, Check, FileKey, Radio, Server, ShieldCheck, WalletCards, X } from 'lucide-react'
import type { InjectiveConfigStatus } from '../domain/trading'

interface InjectiveConfigDrawerProps {
  open: boolean
  status?: InjectiveConfigStatus
  error?: string
  onClose: () => void
}

export function InjectiveConfigDrawer({ open, status, error, onClose }: InjectiveConfigDrawerProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="config-overlay" role="presentation" onMouseDown={onClose}>
      <section className="config-drawer" role="dialog" aria-modal="true" aria-labelledby="config-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="config-header">
          <div>
            <span className="eyebrow">Server-side configuration</span>
            <h2 id="config-title">Injective 测试网配置</h2>
          </div>
          <button className="icon-button" title="关闭配置" onClick={onClose}><X size={17} /></button>
        </div>

        {error && <div className="config-alert"><AlertTriangle size={15} /> {error}</div>}

        {status && (
          <>
            <div className={`config-readiness ${status.readyForExecution ? 'ready' : 'pending'}`}>
              {status.readyForExecution ? <ShieldCheck size={20} /> : <AlertTriangle size={20} />}
              <div>
                <strong>{status.mode === 'mock' ? 'Mock 执行已启用' : '测试网执行尚未启用'}</strong>
                <span>{status.credentialsConfigured ? '签名配置已填写' : `仍缺少 ${status.missing.length} 项签名配置`}</span>
              </div>
              <code>{status.mode.toUpperCase()}</code>
            </div>

            <div className="config-section">
              <h3><Radio size={14} /> 网络</h3>
              <dl className="config-list">
                <div><dt>Network</dt><dd>{status.network}</dd></div>
                <div><dt>Chain ID</dt><dd>{status.chainId}</dd></div>
                <div><dt>RPC</dt><dd title={status.endpoints.rpc}>{status.endpoints.rpc}</dd></div>
                <div><dt>REST</dt><dd title={status.endpoints.rest}>{status.endpoints.rest}</dd></div>
                <div><dt>gRPC</dt><dd title={status.endpoints.grpc}>{status.endpoints.grpc}</dd></div>
              </dl>
            </div>

            <div className="config-section">
              <h3><WalletCards size={14} /> 签名与市场</h3>
              <dl className="config-list">
                <div><dt>Wallet</dt><dd className={status.walletAddress ? 'configured' : 'missing'}>{status.walletAddress ?? '未配置'}</dd></div>
                <div><dt>Market ID</dt><dd className={status.marketIdConfigured ? 'configured' : 'missing'}>{status.marketIdConfigured ? '已配置' : '未配置'}</dd></div>
                <div><dt>Subaccount</dt><dd className={status.subaccountIdConfigured ? 'configured' : 'missing'}>{status.subaccountIdConfigured ? '已配置' : '未配置'}</dd></div>
              </dl>
            </div>

            {status.missing.length > 0 && (
              <div className="missing-config">
                <span>缺失变量</span>
                <div>{status.missing.map((item) => <code key={item}>{item}</code>)}</div>
              </div>
            )}

            <div className="config-file-location">
              <FileKey size={16} />
              <div><span>本地配置文件</span><code>web/.env.local</code></div>
              <Check size={14} />
            </div>
            <p className="secret-note"><Server size={13} /> 私钥仅由 API 服务读取，不通过浏览器接口返回。</p>
          </>
        )}
      </section>
    </div>
  )
}
