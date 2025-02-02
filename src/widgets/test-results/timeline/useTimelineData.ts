import { useMemo } from "react";
import usePatientResultsData from "../loadPatientTestData/usePatientResultsData";
import { ObsRecord } from "../loadPatientTestData/types";

const parseTime = (sortedTimes: string[]) => {
  const yearColumns: Array<{ year: string; size: number }> = [],
    dayColumns: Array<{ year: string; day: string; size: number }> = [],
    timeColumns: string[] = [];

  sortedTimes.forEach(datetime => {
    const [year, month, day, hour, minutes] = datetime.split(/[-,T,:]/);
    const date = `${month}/${day}`;
    const time = `${hour}:${minutes}`;

    const yearColumn = yearColumns.find(
      ({ year: innerYear }) => year === innerYear
    );
    if (yearColumn) yearColumn.size++;
    else yearColumns.push({ year, size: 1 });

    const dayColumn = dayColumns.find(
      ({ year: innerYear, day: innerDay }) =>
        date === innerDay && year === innerYear
    );
    if (dayColumn) dayColumn.size++;
    else dayColumns.push({ day: date, year, size: 1 });

    timeColumns.push(time);
  });

  return { yearColumns, dayColumns, timeColumns, sortedTimes };
};

const parseEntries = (entries: ObsRecord[]) => {
  const rows: Record<string, Array<ObsRecord | undefined>> = {};

  entries.forEach((entry, index) => {
    const { members } = entry;
    members.forEach(member => {
      const { name } = member;
      const row = rows[name] || (rows[name] = []);
      row[index] = member;
    });
  });

  Object.entries(rows).forEach(([key, value]) => (rows[key] = [...value]));

  return rows;
};

export const useTimelineData = (patientUuid: string, panelUuid: string) => {
  const { sortedObs, loaded, error } = usePatientResultsData(patientUuid);

  const timelineData = useMemo(() => {
    if (!sortedObs || !loaded || !!error)
      return {
        data: { parsedTime: {} as ReturnType<typeof parseTime> },
        loaded,
        error
      };

    const [panelName, panelData] =
      Object.entries(sortedObs).find(([, { uuid }]) => uuid === panelUuid) ||
      [];
    if (!panelData)
      return {
        data: { parsedTime: {} as ReturnType<typeof parseTime> },
        loaded,
        error: new Error("panel data missing")
      };

    const { entries } = panelData;
    const times = entries.map(e => e.effectiveDateTime);

    const rowData = parseEntries(entries);

    return {
      data: { parsedTime: parseTime(times), rowData, panelName },
      loaded: true
    };
  }, [sortedObs, loaded, error]);
  return timelineData;
};
