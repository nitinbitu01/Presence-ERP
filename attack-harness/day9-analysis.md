# OTP Sharing — Boundary Analysis (Day 9)

## The Attack

Student A is in the classroom and sees the rotating 6-digit OTP displayed by the teacher.
Student A texts the code to Student B, who is not in the room.
Student B enters the OTP on their own device within the 5-minute rotation window.

**The OTP gate alone cannot stop this.** The OTP is a knowledge factor ("something you know"),
and two people can know the same thing. This is a social vector, not a technical exploit.

## Why It Doesn't Matter in Practice

The OTP is only **one of 12 gates**. Even though Gate 4 passes for both students,
the accomplice is caught by the other layers:

| Gate | What catches the accomplice | Confidence |
|------|----------------------------|------------|
| **Gate 3 — Geofence** | If Student B is not physically in the classroom, the GPS check rejects them. Distance is logged. | High (unless B is also in the room) |
| **Gate 5 — WebAuthn** | Student B's device is not registered under Student A's account. Hardware attestation fails. | **Cryptographic guarantee** |
| **Gate 9 — Face match** | Student B's face ≠ Student A's enrolled face. Cosine similarity < 0.75 → rejected. | High (unless they're twins) |
| **Gate 10 — Device lock** | If B tries to use A's device, the unique index blocks them (one device per session). | Absolute (DB constraint) |
| **Gate 11 — Multi-student flag** | If B uses the same device as A, the 24h rolling window flags it and alerts the admin. | Absolute (async audit) |

## The Worst Case

Student B is:
- Physically in the classroom (passes Gate 3)
- Has their own registered device (passes Gate 5)
- Has the OTP (passes Gate 4)

But **Gate 9 catches them**: Student B's face is not Student A's face.
The face-match gate is the final, non-fakeable barrier.

The only way to defeat all 12 gates is for a person to:
1. Be physically in the room ✓
2. Have a registered device ✓
3. Know the OTP ✓
4. **Have Student A's face** ✗

That last one is a biometric constraint that no amount of social engineering can overcome.

## What to Say in the Pitch

> "The rotating OTP is a knowledge factor — if two people know the code, the OTP alone
> can't tell them apart. We designed for this. The OTP is one gate of twelve.
> The accomplice is caught by geofencing (are they in the room?), by WebAuthn
> (is their device registered?), and ultimately by face match (is it the right person?).
>
> The system doesn't rely on any single gate. It relies on the combination being
> economically and physically impractical to defeat simultaneously."

## Evidence Trail

When this attack is attempted, the admin dashboard shows:
- `attendance_events`: Student B's attempt, rejected at whichever gate caught them
- `gate_reasons.otp.ok: true` — confirming the OTP was correct
- `gate_reasons.identity.similarity: 0.12` — confirming the wrong face
- `reason_code: "identity_no_match"` — the final rejection reason

This evidence trail is itself a deterrent: students know every attempt is logged,
even unsuccessful ones.
