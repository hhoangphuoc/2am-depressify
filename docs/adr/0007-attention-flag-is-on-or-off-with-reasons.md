# The Attention flag is on or off, with reasons

Status: superseded by [ADR 0009](0009-attention-flag-has-three-levels-with-reasons.md).

The Attention flag has no score or severity level. It is raised by a calibrated yes/no judgment on the Check-in transcript or by simple rules on Signals (for example several nights of poor sleep, or missed Check-ins), it always carries written reasons, and only the Clinician clears it. The model can return probabilities, but showing a number would read as a clinical risk assessment, which [ADR 0001](0001-wellbeing-companion-not-clinical-treatment.md) rules out, and a Clinician can act on a reason more easily than on a number.
