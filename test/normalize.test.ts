import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  dedupeConnections,
  normalizeCompanyResponse,
  normalizeConnectionsPage,
  normalizeProfileResponse,
  normalizeSelfProfile
} from "../src/lib/normalize";
import { parseLinkedInUrl } from "../src/lib/linkedinEndpoints";

function readFixture(name: string): unknown {
  const filePath = path.join(process.cwd(), "test", "fixtures", name);
  return JSON.parse(readFileSync(filePath, "utf8"));
}

test("normalizeSelfProfile extracts the signed-in user", () => {
  const data = readFixture("self-profile.json");
  const profile = normalizeSelfProfile(data);

  assert.equal(profile.firstName, "Ada");
  assert.equal(profile.lastName, "Lovelace");
  assert.equal(profile.publicIdentifier, "ada-lovelace");
  assert.equal(profile.profileUrl, "https://www.linkedin.com/in/ada-lovelace");
  assert.equal(profile.dashEntityUrn, "urn:li:fsd_profile:123");
});

test("normalizeProfileResponse extracts public profile data", () => {
  const data = readFixture("profile.json");
  const profile = normalizeProfileResponse(data);

  assert.equal(profile.fullName, "Grace Hopper");
  assert.equal(profile.headline, "Computer Scientist");
  assert.equal(profile.location, "New York, United States");
  assert.equal(profile.publicIdentifier, "grace-hopper");
  assert.equal(profile.companyName, "Navy");
});

test("normalizeCompanyResponse extracts company data", () => {
  const data = readFixture("company.json");
  const company = normalizeCompanyResponse(data);

  assert.equal(company.name, "OpenAI");
  assert.equal(company.universalName, "openai");
  assert.equal(company.linkedinUrl, "https://www.linkedin.com/company/openai");
  assert.equal(company.websiteUrl, "https://openai.com");
  assert.equal(company.industry, "Research Services");
  assert.equal(company.employeeCount, "1000-5000");
});

test("normalizeConnectionsPage parses connection pages and dedupes across pages", () => {
  const page1 = normalizeConnectionsPage(readFixture("connections-page-1.json"));
  const page2 = normalizeConnectionsPage(readFixture("connections-page-2.json"));
  const deduped = dedupeConnections([...page1, ...page2]);

  assert.equal(page1.length, 2);
  assert.equal(page2.length, 2);
  assert.equal(deduped.length, 3);
  assert.equal(deduped[0]?.fullName, "Mary Jones");
  assert.equal(deduped[1]?.fullName, "John Smith");
  assert.equal(deduped[2]?.fullName, "Jane Doe");
});

test("parseLinkedInUrl detects post analytics pages", () => {
  const parsed = parseLinkedInUrl("https://www.linkedin.com/analytics/post-summary/urn:li:activity:7442359911570821120/");

  assert.deepEqual(parsed, {
    pageType: "postAnalytics",
    identifier: "urn:li:activity:7442359911570821120"
  });
});
