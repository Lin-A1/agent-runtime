import { Link } from "react-router-dom"
import { Compass } from "lucide-react"

export function NotFound(): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-bg2 text-faint">
        <Compass size={20} />
      </div>
      <div>
        <p className="text-sm font-medium text-fg">页面不存在</p>
        <p className="mt-1 text-xs text-faint">这个地址没有对应的内容。</p>
      </div>
      <Link to="/" className="btn btn-primary">
        回到封面
      </Link>
    </div>
  )
}
