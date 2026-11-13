# Ideas Junction

Source: [Ideas Junction](https://chatgpt.com/space/page_45ab0a6fd5e481a485930c85067a33ec) (ChatGPT Space, snapshot 2026-11-13)

Challenge: Aalto: Depression “at home” treatment

## The Challenge

Build the product that helps people stay well at home after depression treatment, using anything from natural stimuli to a phone, music, games, light or AI.

## Introduction

Transcranial magnetic stimulation (TMS) is used in hospitals and clinics to treat people with severe depression. The treatment usually requires multiple brief daily visits for brain stimulation. Even if the treatment is successful, there is a risk that depression returns. Therefore, we would like to have “maintenance” treatment at home.

## The Challenge

In the hospital, you can obtain blood samples, get brain scans with fMRI, MEG or EEG, and be consulted by a psychiatrist. At home you don’t have these, except for an occasional remote psychotherapy meeting, and that is also difficult or expensive. But brain activity and mental condition at home can be measured in several ways. No good solution has yet been developed for maintenance treatment at home, and that is the challenge.

Home-based maintenance treatment could also be “closed-loop”, meaning that it is individualised based on how the brain of the patient reacts to the interventions. In other words, your product can work as a loop: sense how someone is doing, respond with something that helps, and learn what works best for that person.

---

# Project Requirement / Audiences

## Insight

### Who You Can Design For

- **People after TMS treatment**, who want to keep feeling well once the daily hospital visits end.
- **Anyone at risk of depression**, who could benefit from early, everyday support.
- **Clinicians**, who want to follow how their patients are doing between visits without adding to their workload.

## Ideas to Get You Started

You don’t need special hardware. A laptop and a phone are enough to build something great.

### What Could Help People Stay Well

- Cleverly designed sensory stimulation (auditory, visual, touch, smell, taste), for example music or rhythmic lights or colours.
- Social interaction, meditation, yoga and physical exercise.
- Regular visits to forests or to the sea, or experiencing them in VR when going out is hard.
- Computer games, such as that of [**Soihtu**](https://soihtudtx.com/).

### How to Sense How Someone Is Doing at Home

- The mobile phone can measure sounds, voice, movement (acceleration), facial expressions, sleep and daily routines.
- Wearables such as smart rings can measure heart signals (HRV), sleep, activity and changes in the autonomic nervous system, a very important indicator of mental state.
- Many other sensors and technologies exist, or can be invented.

### Product Directions We’d Love to See

- **Everyday companion:** a phone or AI check-in that notices changes over time and suggests the right thing at the right moment.
- **Sensory experience:** music, light or VR that adapts to how the person is doing that day.
- **Game:** something fun to play daily that also supports mood and wellbeing.
- **Smart home:** lights and sound that gently change through the day.
- **Social:** a way for friends or peers to stay close and reach out when it matters.
- **Clinician view:** a simple way for professionals to see who might need a call.

For inspiration, look at [**Meru Health**](https://meruhealth.com/) and other companies developing ways to alleviate depression.

---

# Proposal - Project idea

- Patient context can be use as the context and progression data for Clinicians who they can observe and analyse the progress, based on their data

### Gathering the insight

Gather sense of person and how they “feel” → depression:

- Personal Context / Stimuli: Blood, heart rate, Sleep score, vitals are all person (Health API)
- Music taste, current moods based on playlist
- Surrounding: weather, location, places
- Their calendar schedule
- Their clinical report as the first intake

## Agent capabilities:

- Rely on dynamic context based on user pattern
- Reaction proactively to user based on what it feels with surroundings
- Voice with Live conversation to emotionally share and chat and walk through user with their mental wellbeing and depression states
- Optionally can capture visual and emotional through Visual capability (maybe with their video call with family, friends)

## Treatment

- Natural Context:
  - Suggest music genre, based on context and feel
  - Suggest route / places / classes for social interaction where they can use and improve their mood
- Activity suggestions:
  - Social interaction: such as calling for parent, video call with friends (where we can taking insight)
  - Activity: such as yoga classes and meditation classes where they can sign up

# Tech Stack

- Kotlin Multiplatform for mobile app /web-app
- Clinic monitoring dashboard where they can see patient progress tracking
- Gemini API:
  - Voice agent and Live agent for between-sessions treatment
  - Voice agent will be the place for them to day to d
  - Function calling and tool calling to gather the context and finding where the context come from different resources:
- Google API:
  - Maps API & Places API
    - Places and social activities: Meditation, yoga classes
    - Close by Parks with nature / preferences
  - Calendar API:
    - Checking between meetings and treatment session how things goes
  - Weather API:
    - Checking how the weather going on recently, so based on patient context, agent can recommend activity for example: suggesting time for

## Identity:

Patient: User using on daily basic

Voice Agent (AI): For day to day conversation it gather context from agent

Clinician: Person who can observe and
