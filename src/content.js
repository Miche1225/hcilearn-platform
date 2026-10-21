// src/content.js
// Course content the server needs to know about. These mirror the content
// that is hard-coded into the front-end pages, so keep them in sync.

const TOTAL_CASE_STUDIES = 50;
const TOTAL_STUDY_CARD_LESSONS = 11;
// The only videos that count as "watched". Keep in sync with the VIDEOS
// list in public/WatchVideo.html. Titles come from here, not the browser.
const VIDEOS = new Map([
  ['uB9LaBIAcRs', 'Introduction to Human Computer Interaction (HCI)'],
  ['iGmIvuPjv6s', 'HCI: The What and the Importance'],
  ['v__Yhk1U94k', 'Principles of Human Computer Interaction with Examples'],
  ['ESRI4ovEOSo', 'Task-Centered Design | Introduction to HCI'],
  ['4OVptMIxsT4', 'What is the User-Centered Design Process?'],
  ['dRIavYjuXek', 'User-Centered Design (UCD) Process with Examples'],
  ['_r0VX-aU_T8', 'The Design Thinking Process'],
  ['meWKtrZNsRU', 'Principles of Design Thinking'],
  ['_RnuN-e1wsk', "Donald Norman's Model: Execution & Evaluation Loop"],
  ['BZbNNhBPIY8', "Design Rules: Nielsen's 10 Heuristics"],
  ['ETGtsleVOpE', "Jakob Nielsen's 10 Usability Heuristics"],
  ['Dh_6gZSF87Y', 'Gestalt Principles of Design'],
  ['0OPmsy7SXoM', "User Experience Design: Fitts' Law"],
  ['IVUeVUajtZI', "What is Fitts' Law and How to Use It?"],
  ['YtBb-iVjwzw', 'Usability Evaluation in HCI'],
  ['Md-huYID-Mg', 'Prototyping and Usability Testing'],
]);
const TOTAL_VIDEOS = VIDEOS.size;
// Read Lesson topics (accordion items in public/ReadLesson.html)
const TOTAL_LESSON_TOPICS = 137;

module.exports = {
  TOTAL_CASE_STUDIES,
  TOTAL_STUDY_CARD_LESSONS,
  VIDEOS,
  TOTAL_VIDEOS,
  TOTAL_LESSON_TOPICS,
};
