/**
 * DevicePanel.tsx
 * WebAuthn device registration/removal panel.
 */
import type { WebauthnDevice } from "./useEnrollment";

type Props = {
  devices: WebauthnDevice[];
  deviceBusy: boolean;
  deviceError: string | null;
  deviceLabel: string;
  webauthnSupported: boolean;
  isMounted: boolean;
  setDeviceLabel: (v: string) => void;
  onRegister: () => void;
  onRemove: (id: string) => void;
};

export function DevicePanel({
  devices, deviceBusy, deviceError, deviceLabel,
  webauthnSupported, isMounted, setDeviceLabel, onRegister, onRemove,
}: Props) {
  return (
    <section
      aria-label="Registered devices"
      className="border-t border-border px-6 py-4"
    >
      <p className="text-xs font-semibold text-foreground mb-2">
        Registered Devices
      </p>

      {devices.length === 0 ? (
        <p className="text-xs text-muted-foreground">No devices bound yet.</p>
      ) : (
        <ul className="space-y-1" aria-label="Device list">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between text-xs">
              <span className="text-foreground">
                📱 {d.device_label || "Unnamed device"} —{" "}
                {new Date(d.created_at).toLocaleDateString()}
              </span>
              <button
                disabled={deviceBusy}
                onClick={() => onRemove(d.id)}
                aria-label={`Remove device ${d.device_label || "unnamed"}`}
                className="text-destructive underline disabled:opacity-60"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {!isMounted ? (
        <div
          role="status"
          aria-label="Checking authenticator support"
          className="mt-3 py-1 text-xs text-muted-foreground animate-pulse"
        >
          Checking device authenticator support…
        </div>
      ) : webauthnSupported ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="device-label" className="sr-only">
            Device name
          </label>
          <input
            id="device-label"
            value={deviceLabel}
            onChange={(e) => setDeviceLabel(e.target.value)}
            placeholder="Device name (e.g. My Phone)"
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs flex-1 min-w-0"
          />
          <button
            disabled={deviceBusy}
            onClick={onRegister}
            aria-busy={deviceBusy}
            className="rounded-md border border-primary px-3 py-1.5 text-xs text-primary hover:bg-primary/10 disabled:opacity-60"
          >
            {deviceBusy ? "Working…" : "Bind Device"}
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          This browser doesn't support device binding. Try Chrome, Safari, or Edge.
        </p>
      )}

      {deviceError && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {deviceError}
        </p>
      )}
    </section>
  );
}
