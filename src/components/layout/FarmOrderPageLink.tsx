import { ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useFarmWorkspace } from '../../lib/farmWorkspace'

export function FarmOrderPageLink({ slug }: { slug: string }) {
  const { isAdminView } = useFarmWorkspace()
  return (
    <div className="flex items-center gap-3">
      {isAdminView && (
        <Link to="/admin/farms" className="text-sm font-medium text-muted hover:text-gray-900">
          관리자 페이지
        </Link>
      )}
      <Link to={`/farm/${slug}`} className="flex items-center gap-1 text-sm font-medium text-primary">
        농가 스토어
        <ExternalLink className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}
