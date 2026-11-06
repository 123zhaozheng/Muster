import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Page, PageBody, PageGrid, PageHeader } from "./index";

afterEach(cleanup);

describe("布局原语", () => {
  it("Page：最大宽 1680 居中，带光晕；fill / noGlow 变体", () => {
    const { container, rerender } = render(<Page data-testid="p">内容</Page>);
    const inner = screen.getByTestId("p");
    expect(inner.className).toContain("max-w-[1680px]");
    expect(inner.className).toContain("mx-auto");
    expect(inner.className).toContain("md:px-8");
    expect(container.querySelector(".muster-page-halo")).toBeTruthy();

    rerender(<Page noGlow fill data-testid="p">内容</Page>);
    expect(container.querySelector(".muster-page-halo")).toBeNull();
    expect(screen.getByTestId("p").className).toContain("min-h-full");
  });

  it("PageHeader：标题 / 副标题 / 操作区", () => {
    render(<PageHeader title="团队" subtitle="你的成员" actions={<button>新建</button>} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("团队");
    expect(screen.getByText("你的成员")).toBeTruthy();
    expect(screen.getByRole("button", { name: "新建" })).toBeTruthy();
  });

  it("PageBody：有右栏时使用两栏并把宽度限制在 340~380；没有右栏不渲染 aside", () => {
    const { container, rerender } = render(<PageBody main={<div>主区</div>} rail={<div>右栏</div>} railWidth={500} />);
    const grid = container.querySelector<HTMLElement>(".grid")!;
    expect(grid.className).toContain("@5xl:grid-cols-[minmax(0,1fr)_var(--muster-rail)]");
    expect(grid.style.getPropertyValue("--muster-rail")).toBe("380px");
    expect(container.querySelector("aside")?.textContent).toBe("右栏");

    rerender(<PageBody main={<div>主区</div>} rail={<div>右栏</div>} railWidth={100} />);
    expect(container.querySelector<HTMLElement>(".grid")!.style.getPropertyValue("--muster-rail")).toBe("340px");

    rerender(<PageBody main={<div>主区</div>} />);
    expect(container.querySelector("aside")).toBeNull();
    expect(container.querySelector(".grid")!.className).not.toContain("@5xl:grid-cols");
  });

  it("PageGrid：自动列 + 依次出现；stretch 使用 auto-fit；可换标签", () => {
    const { container, rerender } = render(
      <PageGrid min={300} data-testid="g">
        <div>a</div>
        <div>b</div>
      </PageGrid>,
    );
    const g = screen.getByTestId("g");
    expect(g.className).toContain("muster-stagger");
    expect(g.style.gridTemplateColumns).toContain("auto-fill");
    expect(g.style.gridTemplateColumns).toContain("300px");

    rerender(
      <PageGrid stretch as="ul" data-testid="g">
        <li>a</li>
      </PageGrid>,
    );
    expect(container.querySelector("ul")!.style.gridTemplateColumns).toContain("auto-fit");
  });
});
