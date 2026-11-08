import { test } from "node:test";
import assert from "node:assert/strict";
import { groundProfile, isGrounded, statedYears } from "./resume-profile";

// Shaped like a real resume (names made up where they are not the point).
const RESUME = `PRANJUL GUPTA SAP BW/4HANA Consultant | 5 Years of Experience
PROFILE SUMMARY SAP BW/4HANA Consultant with equivalent to 5 years of experience in designing data models.
EXPERIENCE Apprisia Consulting LLP, Pune. SAP BW/4HANA Developer. Penguin Random House: built ADSO and Composite Provider flows,
Open Hub Destination to Snowflake, SLT replication of 80 data sources, process chain monitoring with ODQMON.
Reduced DTP load time from 3 hours to 10 minutes by tuning package size.
EDUCATION B.Tech, Arya College of Engineering and Information Technology, Jaipur.
SKILLS ABAP, BEx Query Designer, Analysis for Office, SAC.`;

test("an employer the resume never mentions is not grounded", () => {
  assert.equal(isGrounded("SAP BW/4HANA Consultant at Tata Consultancy Services", RESUME), false);
  assert.equal(isGrounded("B.Tech CSE, Visvesvaraya Technological University", RESUME), false);
});

test("names that are on the resume are grounded", () => {
  assert.equal(isGrounded("SAP BW/4HANA Developer at Apprisia Consulting", RESUME), true);
  assert.equal(isGrounded("B.Tech, Arya College of Engineering", RESUME), true);
  assert.equal(isGrounded("Composite Provider", RESUME), true);
  assert.equal(isGrounded("Cut a DTP load from 3 hours to 10 minutes", RESUME), true);
});

test("stated years come from the resume", () => {
  assert.equal(statedYears(RESUME), 5);
  assert.equal(statedYears("Engineer with 3+ yrs of hands-on experience"), 3);
  assert.equal(statedYears("Final year student"), null);
});

test("the grounded profile drops invented facts and keeps the stated years", () => {
  const profile = groundProfile(
    {
      experienceYears: 4,
      experienceNote: "",
      currentRole: "SAP BW/4HANA Consultant at Tata Consultancy Services",
      education: "B.Tech CSE, Visvesvaraya Technological University",
      topSkills: ["SAP BW/4HANA", "ADSO", "Composite Provider", "Kubernetes"],
      standouts: ["openSAP SAP BW/4HANA certification", "Replicated 80 data sources with SLT"],
    },
    RESUME,
  );
  assert.ok(profile);
  assert.equal(profile.experienceYears, 5);
  assert.equal(profile.currentRole, "");
  assert.equal(profile.education, "");
  assert.deepEqual(profile.topSkills, ["SAP BW/4HANA", "ADSO", "Composite Provider"]);
  assert.deepEqual(profile.standouts, ["Replicated 80 data sources with SLT"]);
});
