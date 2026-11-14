# Depressify

A wellbeing companion that helps a person stay well at home after depression treatment, and lets their clinician see how they are doing between visits.

## Language

### People

**Patient**:
A person who has finished TMS treatment and uses the app day to day.
_Avoid_: User, client

**Demo Patient**:
A Patient that exists only for testing and demos, whose Signals and history are synthetic.
_Avoid_: Test account, fake user, mock

**Clinician**:
A care professional who follows the progress of the Patients linked to them.
_Avoid_: Doctor, therapist, admin

**Companion**:
The AI the Patient talks with. It supports and suggests; it never diagnoses or advises on treatment.
_Avoid_: Voice agent, bot, assistant, therapist

**Visit**:
An appointment between a Patient and their Clinician. The product exists for the time between Visits.
_Avoid_: Session, treatment session, appointment

**Phase**:
The stretch of time between two Visits, or between the end of TMS and the first Visit. Progress is read Phase by Phase.
_Avoid_: Stage, period, cycle

### Sensing

**Signal**:
One kind of measurement about a Patient's day, such as sleep, heart rate, weather or calendar load.
_Avoid_: Stimuli, metric, data point

**Context**:
The current picture of a Patient built from their Signals, Intake and past Check-ins.
_Avoid_: Profile, state

**Baseline**:
A Patient's own typical value for a Signal over the previous two weeks. A Signal is only ever compared with that Patient's Baseline.
_Avoid_: Normal range, average, target

**Brief**:
The part of the Context given to the Companion at the start of a Check-in.
_Avoid_: Prompt, memory, preliminary context

**Intake**:
The clinical report that describes a Patient at the start, supplied once.
_Avoid_: Onboarding, clinical report

**Consent**:
A Patient's explicit permission for one Signal to be collected or for their Clinician to see their progress. Withdrawing it stops collection and deletes what was collected.
_Avoid_: Permission, opt-in

**Mood rating**:
A number from 1 to 5 the Patient gives for their mood at a Check-in. Energy and sleep quality are rated the same way.
_Avoid_: Mood score, questionnaire, assessment

**Voice cue**:
Something the Companion notices in how the Patient sounds, such as a flat tone or hesitation. It is an observation, never a diagnosis.
_Avoid_: Emotion detection, sentiment, voice biomarker

**Invite**:
The code a Clinician gives a Patient to link the two. Each Patient has exactly one Clinician.
_Avoid_: Referral, pairing code

### Responding

**Check-in**:
One conversation between a Patient and the Companion, spoken or typed, lasting a few minutes.
_Avoid_: Session, call, chat

**Nudge**:
A notification inviting the Patient to start a Check-in. The Patient always starts the conversation.
_Avoid_: Reminder, proactive call, alert

**Suggestion**:
A concrete activity the Companion proposes, such as a walk, a class, music or calling someone.
_Avoid_: Treatment, intervention, recommendation, prescription

**Outcome**:
What the Patient reports about a past Suggestion: whether they tried it and how it felt.
_Avoid_: Feedback, result, adherence

### Clinician view

**Summary**:
A written account of a Patient's Check-in or period, generated for the Clinician.
_Avoid_: Report, transcript, notes

**Digest**:
A short weekly account of one Patient, generated for the Clinician from that week's Summaries and Signals.
_Avoid_: Weekly report, newsletter

**Questionnaire score**:
A PHQ-2 or PHQ-9 result the Clinician records at a Visit. The Companion never asks these questions.
_Avoid_: Screening, assessment, risk score

**Attention flag**:
A level on a Patient (green, amber or red), always with written reasons and never a number, telling the Clinician whether this person may need a call. The Clinician clears it after acting.
_Avoid_: Risk score, alert, diagnosis

**Assessment** (of a Check-in):
Whether the automatic review after a Check-in could judge it: assessed, unassessed (it declined to judge, which raises an amber Attention flag) or unavailable (it failed, so the Patient keeps the last known level). It records how the review went, never a result about the Patient; a Mood rating or Questionnaire score is never called an assessment.
_Avoid_: Risk assessment, screening

**Crisis notice**:
The screen shown to the Patient when a Check-in shows signs of self-harm risk, with one-tap buttons to call for help. The Patient places the call; the app never dials.
_Avoid_: Emergency mode, intervention
