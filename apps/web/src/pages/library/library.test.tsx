import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Library from "./index";

describe("资源库", () => {
  afterEach(cleanup);

  it("诚实空态：标注即将推出，不展示文件", () => {
    render(<Library />);
    expect(screen.getByText("即将推出")).toBeTruthy();
    expect(screen.getByText("任务产出的文档、图片会出现在这里")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
