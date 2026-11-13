# 2am Depressify

A wellbeing companion that helps a person stay well at home after depression treatment, and lets their clinician see how they are doing between visits.

## Language

### People

**Patient**:
A person who has finished TMS treatment and uses the app day to day.
_Avoid_: User, client

**Clinician**:
A care professional who follows the progress of the Patients linked to them.
_Avoid_: Doctor, therapist, admin

**Companion**:
The AI the Patient talks with. It supports and suggests; it never diagnoses or advises on treatment.
_Avoid_: Voice agent, bot, assistant, therapist

### Sensing

**Signal**:
One kind of measurement about a Patient's day, such as sleep, heart rate, weather or calendar load.
_Avoid_: Stimuli, metric, data point

**Context**:
The current picture of a Patient built from their Signals, Intake and past Check-ins.
_Avoid_: Profile, state

**Intake**:
The clinical report that describes a Patient at the start, supplied once.
_Avoid_: Onboarding, clinical report

**Consent**:
A Patient's explicit, revocable permission for one Signal to be collected or for their Clinician to see their progress.
_Avoid_: Permission, opt-in

### Responding

**Check-in**:
One spoken conversation between a Patient and the Companion.
_Avoid_: Session, call, chat

**Nudge**:
A notification inviting the Patient to start a Check-in. The Patient always starts the conversation.
_Avoid_: Reminder, proactive call, alert

**Suggestion**:
A concrete activity the Companion proposes, such as a walk, a class, music or calling someone.
_Avoid_: Treatment, intervention, recommendation, prescription

### Clinician view

**Summary**:
A written account of a Patient's Check-in or period, generated for the Clinician.
_Avoid_: Report, transcript, notes

**Attention flag**:
A mark on a Patient telling the Clinician this person may need a call.
_Avoid_: Risk score, alert, diagnosis

**Crisis notice**:
The helpline information shown to the Patient when a Check-in shows signs of self-harm risk.
_Avoid_: Emergency mode, intervention
