import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { setupHub } from "../../components/settings/testSetup";
import Memory from "./index";

describe("记忆", () => {
  beforeEach(() => { setupHub(); });
  afterEach(cleanup);

  it("显示空状态说明", () => {
    render(<Memory />);
    expect(screen.getByText(/会记住你的偏好，你可以查看、修改、删除/)).toBeTruthy();
  });

  it("有说明卡：会记住什么、如何管理", () => {
    render(<Memory />);
    expect(screen.getByText("会记住什么")).toBeTruthy();
    expect(screen.getByText("如何管理记忆")).toBeTruthy();
    expect(screen.getByText("一键删除")).toBeTruthy();
  });
});
