import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { setupHub } from "../../components/settings/testSetup";
import Memory from "./index";

describe("记忆", () => {
  beforeEach(() => { setupHub(); });
  afterEach(cleanup);

  it("诚实空态：标注尚未开放，没有任何假记忆", () => {
    render(<Memory />);
    expect(screen.getByText("记忆功能尚未开放")).toBeTruthy();
    expect(screen.getByText("尚未开放")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});
