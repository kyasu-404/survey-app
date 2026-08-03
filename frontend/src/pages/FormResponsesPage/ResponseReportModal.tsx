import { getOrganizationDisplayName, getOrganizationTypeLabel } from "../../entities/organization/model";
import type { ResponseReport } from "../../shared/lib/responseReport";

export function ResponseReportModal({ report, onClose }: { report: ResponseReport; onClose: () => void }) {
  return (
    <div className="modal-backdrop response-report-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-card card response-report-modal" role="dialog" aria-modal="true" aria-label="Отчёт по ответам">
        <div className="response-report-header">
          <div>
            <p>Аналитика формы</p>
            <h2>Отчёт по ответам</h2>
          </div>
          <button type="button" className="response-preview-close" onClick={onClose}>Закрыть</button>
        </div>

        <div className="response-report-summary">
          <div><span>Всего ответов</span><strong>{report.totalResponses}</strong></div>
          {report.organizationCoverage && (
            <>
              <div><span>Сдали организации</span><strong>{report.organizationCoverage.submittedCount}</strong></div>
              <div><span>Не сдали</span><strong>{report.organizationCoverage.missingOrganizations.length}</strong></div>
            </>
          )}
        </div>

        <section className="response-report-section">
          <h3>Заполнение полей</h3>
          <div className="response-report-questions">
            {report.questionReports.map((question) => (
              <article key={question.name} className="response-report-question">
                <div className="response-report-question-heading">
                  <strong>{question.title}</strong>
                  <span>Заполнено: {question.answeredCount} · Пропущено: {question.missingCount}</span>
                </div>
                {question.values.length > 0 && (
                  <div className="response-report-values">
                    {question.values.map((value) => (
                      <div key={value.label}><span>{value.label}</span><strong>{value.count}</strong></div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>

        {report.organizationCoverage && (
          <section className="response-report-section">
            <h3>Кто не сдал</h3>
            {report.organizationCoverage.missingOrganizations.length === 0 ? (
              <p className="response-report-complete">Все выбранные организации сдали форму.</p>
            ) : (
              <div className="response-report-missing-table-shell">
                <table className="responses-table response-report-missing-table">
                  <thead><tr><th>Тип ОУ</th><th>Организация</th><th>Email</th></tr></thead>
                  <tbody>
                    {report.organizationCoverage.missingOrganizations.map((organization) => (
                      <tr key={organization.id}>
                        <td>{getOrganizationTypeLabel(organization.organization_type, true)}</td>
                        <td>{getOrganizationDisplayName(organization)}</td>
                        <td><a href={`mailto:${organization.email}`}>{organization.email}</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
