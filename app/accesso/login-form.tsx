"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="mt-6 space-y-3">
      <input type="hidden" name="da" value={next} />
      <label className="block text-sm font-medium" htmlFor="code">
        Codice di accesso
      </label>
      <input
        id="code"
        name="code"
        type="password"
        autoComplete="current-password"
        required
        className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm outline-none focus:border-ink"
      />
      {state?.error ? <p className="text-sm text-neg">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink disabled:opacity-60"
      >
        {pending ? "Verifica…" : "Entra"}
      </button>
    </form>
  );
}
