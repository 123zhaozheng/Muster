import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, ArrowRight, Rocket } from "lucide-react";
import { MAIN_BOT_ID } from "@muster/protocol";
import { Button, Pebble } from "@muster/ui";
import { DetectStep } from "../../components/onboarding/DetectStep";
import { ModelStep } from "../../components/onboarding/ModelStep";
import { DoneStep, LAST_STEP, LookStep, ONBOARDED_KEY, PROFILE_KEY, StepIndicator, WelcomeStep, type Profile } from "../../components/onboarding/Steps";
import { hubRequest, useHub } from "../../lib/hub";

export default function OnboardingPage() {
  const navigate = useNavigate();
  const pip = useHub((s) => s.model.bots[MAIN_BOT_ID]);
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<Profile>({ name: pip?.name ?? "Pip", shape: pip?.shape ?? "round", color: pip?.color ?? "cream" });
  const [modelLabel, setModelLabel] = useState<string>();
  const [agentCount, setAgentCount] = useState<number>();

  const finish = () => {
    const final = { ...profile, name: profile.name.trim() || "Pip" };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(final));
    localStorage.setItem(ONBOARDED_KEY, "1");
    // 同步给 daemon；失败不阻塞进入主线（本机已有兜底）。
    hubRequest("bot.update", { botId: MAIN_BOT_ID, patch: { name: final.name, shape: final.shape, color: final.color } }).catch(() => undefined);
    navigate("/", { replace: true });
  };
  const skip = () => {
    localStorage.setItem(ONBOARDED_KEY, "1");
    navigate("/", { replace: true });
  };

  const nameMissing = step === 1 && profile.name.trim() === "";
  const name = profile.name.trim() || "Pip";

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-canvas">
      {/* 背景光晕：缓慢漂浮的三团色块 */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span className="muster-halo absolute -right-40 -top-40 size-[640px] rounded-full opacity-90" style={{ ["--halo" as string]: "#ff8a65" }} />
        <span className="muster-halo absolute -bottom-48 -left-40 size-[620px] rounded-full opacity-90" style={{ ["--halo" as string]: "#8b7cf6" }} />
        <span className="muster-halo absolute left-1/2 top-1/3 size-[480px] -translate-x-1/2 rounded-full opacity-50" style={{ ["--halo" as string]: "#34c58a" }} />
      </div>

      <header className="relative flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-2.5">
          <Pebble shape={profile.shape} color={profile.color} status="idle" size={32} lite interactive={false} />
          <span className="text-xl font-semibold tracking-tight text-ink">Muster</span>
        </div>
        {step < LAST_STEP && <Button variant="ghost" size="sm" onClick={skip}>跳过引导</Button>}
      </header>
      <div className="relative px-8"><StepIndicator step={step} /></div>

      <main key={step} className="muster-page-enter relative flex flex-1 items-center justify-center overflow-y-auto px-8 py-8" data-step={step}>
        <div className="w-full">
          {step === 0 && <WelcomeStep name={name} />}
          {step === 1 && <LookStep profile={profile} onChange={(patch) => setProfile((p) => ({ ...p, ...patch }))} />}
          {step === 2 && <ModelStep onConfigured={setModelLabel} onSkip={() => setStep(3)} />}
          {step === 3 && <DetectStep onResult={setAgentCount} />}
          {step === 4 && <DoneStep profile={profile} modelLabel={modelLabel} agentCount={agentCount} />}
        </div>
      </main>

      <footer className="relative flex items-center justify-between px-8 py-6">
        <Button variant="outline" icon={<ArrowLeft className="size-4" />} onClick={() => setStep((s) => s - 1)} disabled={step === 0}>上一步</Button>
        {step < LAST_STEP ? (
          <Button variant="primary" size="lg" onClick={() => setStep((s) => s + 1)} disabled={nameMissing}>
            下一步 <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button variant="primary" size="lg" onClick={finish}>
            <Rocket className="size-4" /> 开始使用
          </Button>
        )}
      </footer>
    </div>
  );
}
