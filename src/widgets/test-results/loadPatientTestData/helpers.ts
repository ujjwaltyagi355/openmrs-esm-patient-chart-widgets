import {
  PatientData,
  ObsRecord,
  ConceptUuid,
  ConceptRecord,
  ObsMetaInfo
} from "./types";

const PAGE_SIZE = 100;
const CHUNK_PREFETCH_COUNT = 6;

const retrieveFromIterator = <T>(
  iteratorOrIterable: IterableIterator<T>,
  length: number
): Array<T | undefined> => {
  const iterator = iteratorOrIterable[Symbol.iterator]();
  return Array.from({ length }, () => iterator.next().value);
};

let patientResultsDataCache: Record<string, [PatientData, number, string]> = {};

/**
 * Adds given user testresults data to a cache
 *
 * @param patientUuid
 * @param data {PatientData}
 * @param indicator UUID of the newest observation
 */
export const addUserDataToCache = (
  patientUuid,
  data: PatientData,
  indicator
) => {
  patientResultsDataCache[patientUuid] = [data, Date.now(), indicator];
  const currentStateEntries = Object.entries(patientResultsDataCache);

  if (currentStateEntries.length > 3) {
    currentStateEntries.sort(([, [, dateA]], [, [, dateB]]) => dateB - dateA);
    patientResultsDataCache = Object.fromEntries(
      currentStateEntries.slice(0, 3)
    );
  }
};

const getLatestObsUuid = async patientUuid => {
  const request = fhirObservationRequests({
    patient: patientUuid,
    category: "laboratory",
    _sort: "-_date",
    _summary: "data",
    _format: "json",
    _count: "1"
  });

  return (await request.next().value)?.entry?.[0]?.resource?.id;
};

/**
 * Retrieves cached user testresults data
 * Checks the indicator against the backend while doing so
 *
 * @param { string } patientUuid
 * @param { PatientData } data
 * @param { string } indicator UUID of the newest observation
 */
export const getUserDataFromCache = async (
  patientUuid: string
): Promise<PatientData | undefined> => {
  const [data, , indicator] = patientResultsDataCache[patientUuid] || [];

  if (!!data && (await getLatestObsUuid(patientUuid)) === indicator)
    return data;
};

/**
 * Iterator
 * @param queries
 */
function* fhirObservationRequests(queries: Record<string, string>) {
  const fhirPathname = `${window.openmrsBase}/ws/fhir2/R4/Observation`;
  const path =
    fhirPathname +
    "?" +
    Object.entries(queries)
      .map(([q, v]) => q + "=" + v)
      .join("&");

  const pathWithPageOffset = offset =>
    path + "&_getpagesoffset=" + offset * PAGE_SIZE;
  let offsetCounter = 0;
  while (true) {
    yield fetch(pathWithPageOffset(offsetCounter++)).then(res => res.json());
  }
}

/**
 * Load all patient testresult observations in parallel
 *
 * @param { string } patientUuid
 * @returns { Promise<ObsRecord[]> }
 */
export const loadObsEntries = async (
  patientUuid: string
): Promise<ObsRecord[]> => {
  const requests = fhirObservationRequests({
    patient: patientUuid,
    category: "laboratory",
    _sort: "-_date",
    _summary: "data",
    _format: "json",
    _count: "" + PAGE_SIZE
  });

  let responses = await Promise.all(
    retrieveFromIterator(requests, CHUNK_PREFETCH_COUNT)
  );

  const total = responses[0].total;

  if (total > CHUNK_PREFETCH_COUNT * PAGE_SIZE) {
    const missingRequestsCount =
      Math.ceil(total / PAGE_SIZE) - CHUNK_PREFETCH_COUNT;
    responses = [
      ...responses,
      ...(await Promise.all(
        retrieveFromIterator(requests, missingRequestsCount)
      ))
    ];
  }

  return responses
    .slice(0, Math.ceil(total / PAGE_SIZE))
    .flatMap(res => res.entry.map(e => e.resource));
};

export const getEntryConceptClassUuid = entry => entry.code.coding[0].code;

const conceptCache: Record<ConceptUuid, Promise<ConceptRecord>> = {};
/**
 * fetch all concepts for all given observation entries
 */
export const loadPresentConcepts = (
  entries: ObsRecord[]
): Promise<ConceptRecord[]> =>
  Promise.all(
    [...new Set(entries.map(getEntryConceptClassUuid))].map(
      conceptUuid =>
        conceptCache[conceptUuid] ||
        (conceptCache[conceptUuid] = fetch(
          `${window.openmrsBase}/ws/rest/v1/concept/${conceptUuid}?v=full`
        ).then(res => res.json()))
    )
  );

/**
 * returns true if no value is null or undefined
 *
 * @param args any
 * @returns {boolean}
 */
export const exist = (...args: any[]): boolean => {
  for (const y of args) {
    if (y === null || y === undefined) return false;
  }
  return true;
};

export enum OBSERVATION_INTERPRETATION {
  "NORMAL",

  "HIGH",
  "CRITICALLY_HIGH",
  "OFF_SCALE_HIGH",

  "LOW",
  "CRITICALLY_LOW",
  "OFF_SCALE_LOW"
}

export const assessValue = (meta: ObsMetaInfo) => (
  value: number
): OBSERVATION_INTERPRETATION => {
  if (exist(meta.hiAbsolute) && value > meta.hiAbsolute) {
    return OBSERVATION_INTERPRETATION.OFF_SCALE_HIGH;
  }

  if (exist(meta.hiCritical) && value > meta.hiCritical) {
    return OBSERVATION_INTERPRETATION.CRITICALLY_HIGH;
  }

  if (exist(meta.hiNormal) && value > meta.hiNormal) {
    return OBSERVATION_INTERPRETATION.HIGH;
  }

  if (exist(meta.lowAbsolute) && value < meta.lowAbsolute) {
    return OBSERVATION_INTERPRETATION.OFF_SCALE_LOW;
  }

  if (exist(meta.lowCritical) && value < meta.lowCritical) {
    return OBSERVATION_INTERPRETATION.CRITICALLY_LOW;
  }

  if (exist(meta.lowNormal) && value < meta.lowNormal) {
    return OBSERVATION_INTERPRETATION.LOW;
  }

  return OBSERVATION_INTERPRETATION.NORMAL;
};

export const extractMetaInformation = (
  concepts: ConceptRecord[]
): Record<ConceptUuid, ObsMetaInfo> => {
  return Object.fromEntries(
    concepts.map(
      ({
        uuid,
        hiAbsolute,
        hiCritical,
        hiNormal,
        lowAbsolute,
        lowCritical,
        lowNormal,
        units,
        datatype: { display: datatype }
      }) => {
        const meta: ObsMetaInfo = {
          hiAbsolute,
          hiCritical,
          hiNormal,
          lowAbsolute,
          lowCritical,
          lowNormal,
          units,
          datatype
        };

        if (exist(hiNormal, lowNormal)) {
          meta.range = `${lowNormal} – ${hiNormal}`;
        }

        meta.assessValue = assessValue(meta);

        return [uuid, meta];
      }
    )
  );
};
