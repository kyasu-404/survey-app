import { useState } from "react";
import { getOrganizationDisplayName, getOrganizationTypeLabel } from "../../entities/organization/model";
import type {
  ResponseQuestionAnalysisKind,
  ResponseReport,
  ResponseReportGroup,
  ResponseReportMetric,
  ResponseReportValue,
} from "../../shared/lib/responseReport";

const ANALYSIS_KIND_LABELS: Record<ResponseQuestionAnalysisKind, string> = {
  "single-choice": "Распределение ответов",
  "multiple-choice": "Распределение выборов",
  numeric: "Числовая статистика",
  rating: "Распределение оценок",
  date: "Распределение по датам",
  time: "Распределение по времени",
  text: "Текстовые ответы",
  ranking: "Позиции вариантов",
  matrix: "Статистика строк и столбцов",
  attachment: "Вложения",
};

function Metrics({ metrics }: { metrics: ResponseReportMetric[] }) {
  if (metrics.length === 0) return null;

  return (
    <div className="response-report-metrics">
      {metrics.map((metric) => (
        <div key={`${metric.label}-${metric.value}`}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </div>
      ))}
    </div>
  );
}

function Distribution({ values }: { values: ResponseReportValue[] }) {
  if (values.length === 0) return null;

  return (
    <div className="response-report-values">
      {values.map((value) => (
        <div key={value.label} className="response-report-value">
          <div className="response-report-value-copy">
            <span>{value.label}</span>
            <strong>{value.count} · {value.percentage}%</strong>
          </div>
          <div className="response-report-value-track" aria-hidden="true">
            <span style={{ width: `${Math.min(100, value.percentage)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Group({ group }: { group: ResponseReportGroup }) {
  return (
    <div className="response-report-group">
      <h4>{group.label}</h4>
      <Metrics metrics={group.metrics} />
      <Distribution values={group.values} />
    </div>
  );
}

export function ResponseReportModal({ report, onClose }: { report: ResponseReport; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<"statistics" | "coverage">("statistics");
  const coverage = report.organizationCoverage;

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

        <div className="response-report-tabs" role="tablist" aria-label="Разделы отчёта">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "statistics"}
            className={activeTab === "statistics" ? "active" : ""}
            onClick={() => setActiveTab("statistics")}
          >
            Статистика
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "coverage"}
            className={activeTab === "coverage" ? "active" : ""}
            disabled={!coverage}
            title={!coverage ? "Добавьте в форму поле «Организация», чтобы включить учёт сдавших" : undefined}
            onClick={() => setActiveTab("coverage")}
          >
            Учёт сдавших
          </button>
        </div>

        {activeTab === "statistics" && (
          <div role="tabpanel" className="response-report-tab-panel">
            <div className="response-report-summary">
              <div><span>Всего ответов</span><strong>{report.totalResponses}</strong></div>
              <div><span>Вопросов в анализе</span><strong>{report.questionReports.length}</strong></div>
            </div>

            {!coverage && (
              <p className="response-report-coverage-note">
                Учёт сдавших недоступен: в форме нет поля «Организация».
              </p>
            )}

            <section className="response-report-section">
              <h3>Анализ вопросов</h3>
              {report.questionReports.length === 0 ? (
                <p className="response-report-empty">В форме нет вопросов, доступных для статистического анализа.</p>
              ) : (
                <div className="response-report-questions">
                  {report.questionReports.map((question) => (
                    <article key={question.name} className="response-report-question">
                      <div className="response-report-question-heading">
                        <strong>{question.title}</strong>
                        <span>{ANALYSIS_KIND_LABELS[question.kind]}</span>
                      </div>
                      <Metrics metrics={question.metrics} />
                      <Distribution values={question.values} />
                      {question.groups.length > 0 && (
                        <div className="response-report-groups">
                          {question.groups.map((group) => <Group key={group.label} group={group} />)}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === "coverage" && coverage && (
          <div role="tabpanel" className="response-report-tab-panel">
            <div className="response-report-summary">
              <div><span>Всего организаций</span><strong>{coverage.expectedCount}</strong></div>
              <div><span>Сдали</span><strong>{coverage.submittedCount}</strong></div>
              <div><span>Не сдали</span><strong>{coverage.missingOrganizations.length}</strong></div>
            </div>

            <section className="response-report-section">
              <h3>Статус сдачи</h3>
              {coverage.expectedCount === 0 ? (
                <p className="response-report-empty">Для формы не выбраны организации.</p>
              ) : (
                <div className="response-report-missing-table-shell">
                  <table className="responses-table response-report-missing-table">
                    <thead><tr><th>Тип ОУ</th><th>Организация</th><th>Email</th><th>Статус</th></tr></thead>
                    <tbody>
                      {coverage.submittedOrganizations.map((organization) => (
                        <tr key={organization.id}>
                          <td>{getOrganizationTypeLabel(organization.organization_type, true)}</td>
                          <td>{getOrganizationDisplayName(organization)}</td>
                          <td><a href={`mailto:${organization.email}`}>{organization.email}</a></td>
                          <td><span className="response-report-status submitted">Сдано</span></td>
                        </tr>
                      ))}
                      {coverage.missingOrganizations.map((organization) => (
                        <tr key={organization.id}>
                          <td>{getOrganizationTypeLabel(organization.organization_type, true)}</td>
                          <td>{getOrganizationDisplayName(organization)}</td>
                          <td><a href={`mailto:${organization.email}`}>{organization.email}</a></td>
                          <td><span className="response-report-status missing">Не сдано</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
