import { Skeleton } from "../../../shared/ui/Skeleton";

export function TemplateSkeletonCards({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div key={`template-skeleton-${index}`} className="dashboard-form-skeleton templates-card-skeleton">
          <div className="dashboard-form-skeleton-header">
            <Skeleton className="dashboard-form-skeleton-pill" />
            <Skeleton className="dashboard-form-skeleton-menu" />
          </div>
          <Skeleton className="dashboard-form-skeleton-title" />
          <div className="dashboard-form-skeleton-meta">
            <Skeleton className="dashboard-form-skeleton-meta-pill dashboard-form-skeleton-meta-pill-wide" />
          </div>
        </div>
      ))}
    </>
  );
}
