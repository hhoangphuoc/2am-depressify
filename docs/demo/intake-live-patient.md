# Intake for the live demo Patient (fictional)

> **Fictional.** This report was written for the 2am demo. It is not about any real person and is not based on one. The names, places, dates and details are all invented.

The live Patient is the one on the demo phone ("Live patient" on the dashboard). On stage the Clinician adds this Intake on the dashboard:

1. Sign in as the demo Clinician, open **Live patient** from the Patient list and find **Intake**.
2. Choose **Add from the report**, paste the report below and choose **Extract highlights**.
3. Compare the preview with the expected highlights below. They do not need to match word for word. Check that the preview has no diagnostic labels, no medicine and no scores, and that it is at most 120 words.
4. Make sure the first line reads `Fictional demo data.` (add it if it is missing), then choose **Save highlights**. The Intake section now shows the saved highlights.

The report is used once to extract highlights and is not saved anywhere. Extraction needs the Gemini key (`GEMINI_API_KEY`) set as a function secret. Without it, the dashboard shows "Could not extract highlights" with **Try again**, and the pasted text stays in the box.

## Report to paste

<!-- report:start -->
```text
FICTIONAL DEMO REPORT. Not about a real person.

Clinic: Riverside Neuromodulation Clinic (fictional). Prepared by: Dr. A. Example (fictional).

Background: 34-year-old graphic designer who works part time from home. Lives with partner Sam and a cat called Biscuit. Older sister Mira phones every Sunday and is a steady support.

Course: completed a six-week TMS course that ended six weeks ago. Antidepressant continued at an unchanged dose; review at the next Visit. PHQ-9 at the end of the course: 9.

Daily life: tends to fall asleep after 1 a.m., usually with the phone in bed, and finds mornings slow. During the course, a short walk along the river most mornings helped to start the day. Used to play trumpet in a community brass band and stopped last year. Enjoys cooking for friends when energy allows.

Stressors: deadlines at the end of each month; dark winter mornings.

Preferences: likes plain, direct language. Does not like being cheered up or told to "stay positive". Prefers practical, small next steps.

Plan: Visit with the Clinician in four weeks. Contact the clinic if mood drops sharply.
```
<!-- report:end -->

## Expected highlights

What a good extraction looks like after the Clinician's review (functions test `demo-intake.test.ts` checks it is at most 120 words and free of clinical labels):

<!-- highlights:start -->
```text
Fictional demo data.
- Works part time from home as a graphic designer; deadlines at the end of each month are stressful.
- Lives with partner Sam and a cat. Sister Mira phones every Sunday and is a steady support.
- Usually falls asleep after 1 a.m. with the phone in bed; mornings are slow.
- A short walk along the river in the morning has helped to start the day.
- Used to play trumpet in a community brass band; stopped last year. Enjoys cooking for friends.
- Dark winter mornings feel hard.
- Prefers plain, direct language and small practical steps; does not like being cheered up.
```
<!-- highlights:end -->

What the extraction should leave out of this report: the course and its dates, the antidepressant, the PHQ-9 score, the clinic's plan and the contact advice. Those stay with the Clinician.
