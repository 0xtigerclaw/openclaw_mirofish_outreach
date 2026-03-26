import type {
  ConnectionRecord,
  NormalizedCompany,
  NormalizedProfile,
  UserProfile
} from "../types";

type GenericRecord = Record<string, unknown>;

function asRecord(value: unknown): GenericRecord | null {
  return typeof value === "object" && value !== null ? (value as GenericRecord) : null;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractText(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return (
    stringOrNull(record.text) ??
    stringOrNull(record.name) ??
    stringOrNull(record.localizedName) ??
    stringOrNull(record.defaultLocalizedName) ??
    null
  );
}

function pickText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = extractText(value);
    if (text) {
      return text;
    }
  }
  return null;
}

function fullName(firstName: unknown, lastName: unknown): string | null {
  const first = pickText(firstName);
  const last = pickText(lastName);
  const combined = [first, last].filter(Boolean).join(" ").trim();
  return combined || null;
}

function isoFromEpochMs(value: unknown): string | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

function getCompanyNameFromProfileRecord(profile: GenericRecord): string | null {
  const profileTopPosition = asRecord(profile.profileTopPosition);
  const elements = asArray(profileTopPosition?.elements);
  const firstElement = asRecord(elements[0]);
  const company = asRecord(firstElement?.company);
  return pickText(company?.name, profile.companyName, profile.currentCompanyName);
}

export function normalizeSelfProfile(raw: unknown): UserProfile {
  const record = asRecord(raw);
  const miniProfile = asRecord(record?.miniProfile);

  const publicIdentifier = stringOrNull(miniProfile?.publicIdentifier);
  return {
    firstName: pickText(miniProfile?.firstName),
    lastName: pickText(miniProfile?.lastName),
    publicIdentifier,
    profileUrl: publicIdentifier ? `https://www.linkedin.com/in/${publicIdentifier}` : null,
    dashEntityUrn: stringOrNull(miniProfile?.dashEntityUrn)
  };
}

export function normalizeProfileResponse(
  raw: unknown,
  fallbackIdentifier: string | null = null
): NormalizedProfile {
  const record = asRecord(raw);
  const data = asRecord(record?.data);
  const profiles = asRecord(data?.identityDashProfilesByMemberIdentity);
  const elements = asArray(profiles?.elements);
  const profile = asRecord(elements[0]) ?? {};

  const publicIdentifier = stringOrNull(profile.publicIdentifier) ?? fallbackIdentifier;
  return {
    fullName: fullName(profile.firstName, profile.lastName),
    headline: pickText(profile.headline, profile.occupation, profile.summary, profile.primarySubtitle),
    location: pickText(
      asRecord(profile.location)?.defaultLocalizedName,
      asRecord(profile.location)?.countryCode,
      profile.locationName
    ),
    publicIdentifier,
    profileUrl: publicIdentifier ? `https://www.linkedin.com/in/${publicIdentifier}` : null,
    entityUrn: stringOrNull(profile.entityUrn),
    companyName: getCompanyNameFromProfileRecord(profile),
    raw
  };
}

export function normalizeCompanyResponse(
  raw: unknown,
  fallbackUniversalName: string | null = null
): NormalizedCompany {
  const record = asRecord(raw);
  const data = asRecord(record?.data);
  const companies = asRecord(data?.organizationDashCompaniesByUniversalName);
  const elements = asArray(companies?.elements);
  const company = asRecord(elements[0]) ?? {};
  const industryArray = asArray(company.industry);
  const firstIndustry = asRecord(industryArray[0]);
  const universalName = stringOrNull(company.universalName) ?? fallbackUniversalName;
  const employeeCountRange = asRecord(company.employeeCountRange);

  let employeeCount = stringOrNull(company.employeeCount);
  if (!employeeCount && employeeCountRange) {
    const start = stringOrNull(employeeCountRange.start) ?? employeeCountRange.start;
    const end = stringOrNull(employeeCountRange.end) ?? employeeCountRange.end;
    if (typeof start === "number" || typeof start === "string") {
      employeeCount = `${start}${end ? `-${end}` : ""}`;
    }
  }

  return {
    name: pickText(company.name),
    universalName,
    linkedinUrl: universalName ? `https://www.linkedin.com/company/${universalName}` : null,
    websiteUrl: stringOrNull(company.websiteUrl),
    industry: pickText(firstIndustry?.name),
    employeeCount,
    description: pickText(company.description),
    raw
  };
}

function buildConnectionRecord(
  profile: GenericRecord,
  connectedAt: string | null,
  connectionRaw: unknown
): ConnectionRecord {
  const publicIdentifier = stringOrNull(profile.publicIdentifier);
  const entityUrn = stringOrNull(profile.entityUrn);

  return {
    fullName: fullName(profile.firstName, profile.lastName) ?? pickText(profile.name),
    publicIdentifier,
    profileUrl: publicIdentifier ? `https://www.linkedin.com/in/${publicIdentifier}` : null,
    entityUrn,
    headline: pickText(profile.headline, profile.occupation, profile.primarySubtitle, profile.summary),
    companyName: getCompanyNameFromProfileRecord(profile),
    connectedAt,
    raw: {
      profile,
      connection: connectionRaw
    }
  };
}

export function normalizeConnectionsPage(raw: unknown): ConnectionRecord[] {
  const record = asRecord(raw);
  const included = asArray(record?.included);

  const connectionMeta = new Map<
    string,
    {
      connectedAt: string | null;
      raw: unknown;
    }
  >();

  for (const item of included) {
    const current = asRecord(item);
    if (!current) {
      continue;
    }

    const type = stringOrNull(current.$type);
    const connectedMember = stringOrNull(current.connectedMember);
    if (type?.includes("Connection") && connectedMember) {
      connectionMeta.set(connectedMember, {
        connectedAt: isoFromEpochMs(current.createdAt),
        raw: current
      });
    }
  }

  const results: ConnectionRecord[] = [];
  for (const item of included) {
    const profile = asRecord(item);
    if (!profile) {
      continue;
    }

    const entityUrn = stringOrNull(profile.entityUrn);
    if (!entityUrn || !connectionMeta.has(entityUrn)) {
      continue;
    }

    const meta = connectionMeta.get(entityUrn)!;
    const publicIdentifier = stringOrNull(profile.publicIdentifier);
    const first = pickText(profile.firstName);
    const last = pickText(profile.lastName);
    if (!publicIdentifier && !first && !last) {
      continue;
    }

    results.push(buildConnectionRecord(profile, meta.connectedAt, meta.raw));
  }

  return results;
}

export function countConnectionEntities(raw: unknown): number {
  const record = asRecord(raw);
  const included = asArray(record?.included);

  return included.reduce<number>((count, item) => {
    const current = asRecord(item);
    const type = stringOrNull(current?.$type);
    return type?.includes("Connection") ? count + 1 : count;
  }, 0);
}

function mergeNullableValue<T>(left: T | null, right: T | null): T | null {
  return left ?? right ?? null;
}

export function dedupeConnections(records: ConnectionRecord[]): ConnectionRecord[] {
  const deduped = new Map<string, ConnectionRecord>();

  for (const record of records) {
    const key = record.entityUrn ?? record.publicIdentifier;
    if (!key) {
      continue;
    }

    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, record);
      continue;
    }

    deduped.set(key, {
      fullName: mergeNullableValue(existing.fullName, record.fullName),
      publicIdentifier: mergeNullableValue(existing.publicIdentifier, record.publicIdentifier),
      profileUrl: mergeNullableValue(existing.profileUrl, record.profileUrl),
      entityUrn: mergeNullableValue(existing.entityUrn, record.entityUrn),
      headline: mergeNullableValue(existing.headline, record.headline),
      companyName: mergeNullableValue(existing.companyName, record.companyName),
      connectedAt: mergeNullableValue(existing.connectedAt, record.connectedAt),
      raw: [existing.raw, record.raw]
    });
  }

  return [...deduped.values()].sort((left, right) => {
    if (!left.connectedAt && !right.connectedAt) {
      return 0;
    }
    if (!left.connectedAt) {
      return 1;
    }
    if (!right.connectedAt) {
      return -1;
    }
    return right.connectedAt.localeCompare(left.connectedAt);
  });
}
