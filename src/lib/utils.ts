import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import ExcelJS from "exceljs";
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

export const exportToExcel = async (
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

  // 2. 워크북 및 워크시트 생성
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Tasks");

  // 3. 컬럼 정의 및 너비 설정
  const columns = [
    { key: "ID", header: "ID", width: 10 },
    { key: "Type", header: "Type", width: 15 },
    { key: "Title", header: "Title", width: 50 },
    { key: "Status", header: "Status", width: 15 },
    { key: "Priority", header: "Priority", width: 15 },
    { key: "Dependencies", header: "Dependencies", width: 20 },
    { key: "Notes", header: "Notes", width: 60 },
  ];

  if (includeDetails) {
    columns.push({ key: "Details", header: "Details", width: 80 });
  }

  worksheet.columns = columns;

  // 4. 데이터 추가
  flattenedData.forEach((row) => {
    worksheet.addRow(row);
  });

  // 5. 브라우저에서 다운로드
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileName}.xlsx`;
  link.click();
  window.URL.revokeObjectURL(url);
};
