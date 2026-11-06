import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { MAIN_BOT_ID } from "@muster/protocol";
import { Button, Pebble } from "@muster/ui";
import { DetectStep } from "../../components/onboarding/DetectStep";
import { ModelStep } from "../../components/onboarding/ModelStep";
import { DoneStep, LAST_STEP, LookStep, ONBOARDED_KEY, PROFILE_KEY, StepIndicator, normalizeColor, type Profile } from "../../components/onboarding/Steps";
import { hubRequest, useHub } from "../../lib/hub";

export default function OnboardingPage() {
  const navigate = useNavigate();
  const pip = useHub((s) => s.model.bots[MAIN_BOT_ID]);
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<Profile>({ name: pip?.name ?? "Pip", shape: pip?.shape ?? "round", color: normalizeColor(pip?.color ?? "cream") });
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

  const nameMissing = step === 0 && profile.name.trim() === "";

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex items-center justify-between px-6 py-4 sm:px-8">
        <div className="flex items-center gap-2.5">
          <Pebble shape={profile.shape} color={profile.color} status="idle" size={28} />
          <span className="text-body font-semibold text-fg">Muster</span>
        </div>
        {step < LAST_STEP && <Button variant="ghost" size="sm" onClick={skip}>跳过引导</Button>}
      </header>
      <div className="px-6"><StepIndicator step={step} /></div>

      <main key={step} className="flex flex-1 items-start justify-center overflow-y-auto px-6 py-10" data-step={step}>
        <div className="w-full">
          {step === 0 && <LookStep profile={profile} onChange={(patch) => setProfile((p) => ({ ...p, ...patch }))} />}
          {step === 1 && <ModelStep onConfigured={setModelLabel} onSkip={() => setStep(2)} />}
          {step === 2 && <DetectStep onResult={setAgentCount} />}
          {step === 3 && <DoneStep profile={profile} modelLabel={modelLabel} agentCount={agentCount} />}
        </div>
      </main>

      <footer className="mx-auto flex w-full max-w-md items-center justify-between px-6 pb-10">
        <Button variant="secondary" icon={<ArrowLeft className="size-4" />} onClick={() => setStep((s) => s - 1)} disabled={step === 0}>上一步</Button>
        {step < LAST_STEP ? (
          <Button variant="primary" onClick={() => setStep((s) => s + 1)} disabled={nameMissing}>
            下一步 <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button variant="primary" onClick={finish}>开始使用</Button>
        )}
      </footer>
    </div>
  );
}
