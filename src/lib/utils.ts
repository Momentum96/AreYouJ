import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import * as XLSX from "xlsx";
import type { Task } from "@/types/task";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ExcelRow {
  ID: string;
  Type: "Main Task" | "Subtask";
  Title: string;
  Status: "pending" | "in-progress" | "done";
  Priority: "low" | "medium" | "high";
  Dependencies: string;
  Notes: string;
  Details?: string;
}

export const exportToExcel = (
  tasks: Task[],
  fileName: string,
  includeDetails: boolean
) => {
  // 1. 데이터를 평탄화하고 필요한 필드를 선택합니다.
  const flattenedData: ExcelRow[] = tasks.flatMap((task) => {
    const mainTask: ExcelRow = {
      ID: task.id,
      Type: "Main Task",
      Title: task.title,
      Status: task.status,
      Priority: task.priority,
      Dependencies: task.dependencies.join(", "),
      Notes: task.notes,
    };
    if (includeDetails) {
      mainTask.Details = task.details;
    }

    const subTasks: ExcelRow[] = task.subtasks.map((sub) => {
      const subTask: ExcelRow = {
        ID: sub.id,
        Type: "Subtask",
        Title: `  - ${sub.title}`,
        Status: sub.status,
        Priority: sub.priority,
        Dependencies: sub.dependencies.join(", "),
        Notes: sub.notes,
      };
      if (includeDetails && sub.details) {
        subTask.Details = sub.details;
      }
      return subTask;
    });
    return [mainTask, ...subTasks];
  });

  // 2. 워크시트 생성
  const worksheet = XLSX.utils.json_to_sheet(flattenedData);

  // 3. 컬럼 너비 설정
  const cols = [
    { wch: 10 }, // ID
    { wch: 15 }, // Type
    { wch: 50 }, // Title
    { wch: 15 }, // Status
    { wch: 15 }, // Priority
    { wch: 20 }, // Dependencies
    { wch: 60 }, // Notes
  ];

  if (includeDetails) {
    cols.push({ wch: 80 }); // Details
  }
  worksheet["!cols"] = cols;

  // 4. 워크북 생성 및 워크시트 추가
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Tasks");

  // 5. 파일로 내보내기
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
};
