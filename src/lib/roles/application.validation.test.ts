// Run with: npm test  (node --test, no database or network involved)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applicationFieldsSchema,
  applicationFormFieldsSchema,
  applicationIdentitySchema,
  parseAnswersInput,
  validateAnswers,
  validateRequiredProfileFields,
} from "./application.validation.ts";
import {
  BASE_APPLICATION_FIELDS,
  defaultApplicationFormFields,
  resolveApplicationFormFields,
  suggestFieldId,
} from "./application.types.ts";
import { deriveApplicationStage } from "./hire-stage.ts";

const field = {
  id: "cgpa",
  label: "CGPA",
  type: "number" as const,
  required: true,
};

test("identity accepts a normal applicant", () => {
  const parsed = applicationIdentitySchema.parse({
    name: "  Aditya Rao ",
    phone: "+91 98765 43210",
    email: "ADITYA@medhassoft.com",
    collegeId: "21A91A0501",
  });
  assert.equal(parsed.name, "Aditya Rao");
  assert.equal(parsed.email, "aditya@medhassoft.com");
  assert.equal(parsed.collegeId, "21A91A0501");
});

test("identity rejects a bad phone or email", () => {
  assert.throws(() =>
    applicationIdentitySchema.parse({ name: "A", phone: "12", email: "a@b.co" }),
  );
  assert.throws(() =>
    applicationIdentitySchema.parse({ name: "A", phone: "9876543210", email: "not-an-email" }),
  );
});

test("identity allows a missing college roll number", () => {
  const parsed = applicationIdentitySchema.parse({
    name: "Siva",
    phone: "9876543210",
    email: "siva@example.com",
    collegeId: "",
  });
  assert.equal(parsed.collegeId, "");
});

test("answers are required only when the recruiter marked the field required", () => {
  assert.deepEqual(validateAnswers([field], {}), ["CGPA is required."]);
  assert.deepEqual(validateAnswers([field], { cgpa: "8.4" }), []);
  assert.deepEqual(validateAnswers([{ ...field, required: false }], {}), []);
});

test("number and dropdown answers are checked against their definitions", () => {
  assert.deepEqual(validateAnswers([field], { cgpa: "eight" }), ["CGPA must be a number."]);
  const branch = { id: "branch", label: "Branch", type: "select" as const, required: true, options: ["CSE", "ECE"] };
  assert.deepEqual(validateAnswers([branch], { branch: "MECH" }), [
    "Branch must be one of the offered choices.",
  ]);
  assert.deepEqual(validateAnswers([branch], { branch: "CSE" }), []);
});

test("field definitions reject a dropdown without choices and duplicate ids", () => {
  assert.throws(() =>
    applicationFieldsSchema.parse([{ id: "branch", label: "Branch", type: "select", required: true }]),
  );
  assert.throws(() =>
    applicationFieldsSchema.parse([
      { id: "same", label: "One", type: "text", required: false },
      { id: "same", label: "Two", type: "text", required: false },
    ]),
  );
});

test("answers sent as JSON text are parsed and trimmed", () => {
  assert.deepEqual(parseAnswersInput('{"cgpa":" 8.4 ","note":3}'), { cgpa: "8.4" });
  assert.deepEqual(parseAnswersInput("not json"), {});
  assert.deepEqual(parseAnswersInput(null), {});
});

test("suggestFieldId makes readable, unique ids", () => {
  assert.equal(suggestFieldId("Graduation Year"), "graduation-year");
  assert.equal(suggestFieldId("Graduation Year", ["graduation-year"]), "graduation-year-2");
  assert.equal(suggestFieldId("???"), "field");
});

test("application stage starts Waiting and only Rejected is final", () => {
  assert.equal(deriveApplicationStage("new"), "waiting");
  assert.equal(deriveApplicationStage("scheduled"), "waiting");
  assert.equal(deriveApplicationStage("rejected"), "rejected");
});

test("a role with no saved form still shows the built-in fields", () => {
  const fields = resolveApplicationFormFields(null);
  assert.deepEqual(
    fields.map((field) => field.id),
    BASE_APPLICATION_FIELDS.map((field) => field.id),
  );
  assert.ok(fields.every((field) => field.system === true));
});

test("legacy extra questions keep their order after the built-in fields", () => {
  const fields = resolveApplicationFormFields([
    { id: "portfolio", label: "Portfolio", type: "text", required: false },
  ]);
  assert.equal(fields.length, BASE_APPLICATION_FIELDS.length + 1);
  assert.equal(fields.at(-1)?.id, "portfolio");
});

test("a full form keeps built-in and custom questions in the saved order", () => {
  const fields = defaultApplicationFormFields();
  const custom = { id: "portfolio", label: "Portfolio", type: "text" as const, required: false };
  const reordered = [fields[0], custom, ...fields.slice(1)];
  const parsed = applicationFormFieldsSchema.parse(reordered);
  assert.deepEqual(parsed.map((field) => field.id), reordered.map((field) => field.id));
});

test("essential built-in fields cannot be removed or made optional", () => {
  const withoutEmail = defaultApplicationFormFields().filter((field) => field.id !== "email");
  assert.throws(() => applicationFormFieldsSchema.parse(withoutEmail));

  const optionalEmail = defaultApplicationFormFields().map((field) =>
    field.id === "email" ? { ...field, required: false } : field,
  );
  assert.throws(() => applicationFormFieldsSchema.parse(optionalEmail));
});

test("the roll number is optional and may be removed", () => {
  const withoutCollege = defaultApplicationFormFields().filter(
    (field) => field.id !== "collegeId",
  );
  assert.doesNotThrow(() => applicationFormFieldsSchema.parse(withoutCollege));

  const requiredCollege = defaultApplicationFormFields().map((field) =>
    field.id === "collegeId" ? { ...field, required: true } : field,
  );
  const parsed = applicationFormFieldsSchema.parse(requiredCollege);
  assert.equal(parsed.find((field) => field.id === "collegeId")?.required, true);
  assert.deepEqual(
    validateRequiredProfileFields(parsed, { name: "A", phone: "9876543210", email: "a@b.co" }),
    ["College roll number is required."],
  );
});

test("custom questions cannot use a built-in id or the file type", () => {
  assert.throws(() =>
    applicationFormFieldsSchema.parse([
      ...defaultApplicationFormFields(),
      { id: "email", label: "Shadow email", type: "text", required: false },
    ]),
  );
  assert.throws(() =>
    applicationFormFieldsSchema.parse([
      ...defaultApplicationFormFields(),
      { id: "portfolio", label: "Portfolio file", type: "file", required: false },
    ]),
  );
});

