import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnnouncementContent, safeAnnouncementUrl } from "./AnnouncementContent";

describe("announcement content", () => {
  it("renders paragraphs, inline emphasis, lists and literal HTML as text", () => {
    const { container } = render(<AnnouncementContent
      message={"Расписание **изменилось**\n\n- *Пятница*\n- <b>Суббота</b>"}
      actionUrl="/dashboard/my" />);
    expect(screen.getByText("изменилось").tagName).toBe("STRONG");
    expect(screen.getByText("Пятница").tagName).toBe("EM");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("<b>Суббота</b>")).toBeVisible();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByRole("link", { name: "Подробнее" })).toHaveAttribute("href", "/dashboard/my");
  });
  it("renders combined emphasis and normalizes valid announcement links", () => {
    render(<AnnouncementContent message={"До ***изменения*** и **две\nстроки** после"} />);
    expect(screen.getByText("изменения").closest("strong em")).toBeInTheDocument();
    expect(screen.getByText("две строки", { selector: "strong" })).toBeVisible();
    expect(safeAnnouncementUrl("/news/../profile?a=1#top")).toBe("/profile?a=1#top");
    expect(safeAnnouncementUrl("https://пример.рф:443/новости")).toBe(new URL("https://пример.рф/новости").href);
  });

  it.each(["//other.test", "/.//other.test", "/\\other.test", "data:text/plain,test", "javascript:void(0)", "ftp://example.test",
    "https://name:secret@site.test", "https://site.test/\npart", "/a b"])("rejects unsupported CTA %j", value => {
    expect(safeAnnouncementUrl(value)).toBeNull();
  });
  it("uses an optional link caption and keeps the editor preview inert", () => {
    const content = <AnnouncementContent message="Работы" actionUrl="https://example.test/news" actionLabel="Расписание" />;
    const { rerender } = render(content);
    expect(screen.getByRole("link", { name: "Расписание" })).toHaveAttribute("rel", "noopener noreferrer");
    rerender(<AnnouncementContent {...content.props} preview />);
    expect(screen.getByText("Расписание")).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
