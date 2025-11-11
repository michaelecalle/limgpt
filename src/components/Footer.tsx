import { APP_VERSION } from '../version'

export default function Footer() {
  return (
    <footer className="fixed inset-x-0 bottom-0 z-20">
      <div className="mx-auto max-w-[1366px] px-4 pb-2">
        <div className="pointer-events-auto inline-flex items-center gap-2 rounded-t-lg border-x border-t bg-white/80 px-2 py-1 text-[11px] shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70">
          <span className="opacity-60">Version</span>
          <span className="font-semibold tabular-nums">{APP_VERSION}</span>
        </div>
      </div>
    </footer>
  )
}
