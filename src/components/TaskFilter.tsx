import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Search, X, Filter, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { FilterOptions } from "../types/task";

interface TaskFilterProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  filters: FilterOptions;
  onToggleStatusFilter: (status: "pending" | "in-progress" | "done") => void;
  onTogglePriorityFilter: (priority: "low" | "medium" | "high") => void;
  onUpdateFilter: (key: keyof FilterOptions, value: any) => void;
  onResetFilters: () => void;
  hasActiveFilters: boolean;
  totalTasks: number;
  filteredCount: number;
}

export const TaskFilter = ({
  searchTerm,
  onSearchChange,
  filters,
  onToggleStatusFilter,
  onTogglePriorityFilter,
  onUpdateFilter,
  onResetFilters,
  hasActiveFilters,
  totalTasks,
  filteredCount,
}: TaskFilterProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const statusOptions = [
    {
      value: "pending" as const,
      label: "Pending",
      color: "bg-gray-500/20 text-gray-300 border-gray-500/30",
    },
    {
      value: "in-progress" as const,
      label: "In Progress",
      color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    },
    {
      value: "done" as const,
      label: "Done",
      color: "bg-green-500/20 text-green-300 border-green-500/30",
    },
  ];

  const priorityOptions = [
    {
      value: "low" as const,
      label: "Low",
      color: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    },
    {
      value: "medium" as const,
      label: "Medium",
      color: "bg-orange-500/20 text-orange-300 border-orange-500/30",
    },
    {
      value: "high" as const,
      label: "High",
      color: "bg-red-500/20 text-red-300 border-red-500/30",
    },
  ];

  return (
    <Card>
      <CardContent className="">
        {/* 검색바와 기본 컨트롤 */}
        <div className="flex items-center gap-4 mb-3 pt-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by title, description, ID, notes..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-10 pr-10 py-2 bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-sm"
            />
            {searchTerm && (
              <button
                onClick={() => onSearchChange("")}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Filter className="h-4 w-4" />
                Filter
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    isExpanded ? "rotate-180" : ""
                  }`}
                />
                {hasActiveFilters && (
                  <Badge variant="secondary" className="ml-1 h-5 text-xs">
                    ON
                  </Badge>
                )}
              </Button>
            </CollapsibleTrigger>
          </Collapsible>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onResetFilters}
              className="gap-2 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="h-4 w-4" />
              Reset
            </Button>
          )}
        </div>

        {/* 결과 카운트 */}
        <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
          <span>
            {hasActiveFilters ? (
              <>
                <span className="font-medium text-foreground">
                  {filteredCount}
                </span>{" "}
                tasks (out of {totalTasks} total)
              </>
            ) : (
              <>
                Total{" "}
                <span className="font-medium text-foreground">
                  {totalTasks}
                </span>{" "}
                tasks
              </>
            )}
          </span>
        </div>

        {/* 고급 필터 영역 */}
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <CollapsibleContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-border">
              {/* 상태 필터 */}
              <div>
                <label className="text-sm font-medium mb-2 block">Status</label>
                <div className="space-y-2">
                  {statusOptions.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={filters.status.includes(option.value)}
                        onChange={() => onToggleStatusFilter(option.value)}
                        className="rounded border-border text-primary focus:ring-ring"
                      />
                      <Badge
                        variant="outline"
                        className={`text-xs ${option.color}`}
                      >
                        {option.label}
                      </Badge>
                    </label>
                  ))}
                </div>
              </div>

              {/* 우선순위 필터 */}
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Priority
                </label>
                <div className="space-y-2">
                  {priorityOptions.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={filters.priority.includes(option.value)}
                        onChange={() => onTogglePriorityFilter(option.value)}
                        className="rounded border-border text-primary focus:ring-ring"
                      />
                      <Badge
                        variant="outline"
                        className={`text-xs ${option.color}`}
                      >
                        {option.label}
                      </Badge>
                    </label>
                  ))}
                </div>
              </div>

              {/* 작업 타입 필터 */}
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Task Type
                </label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.showMainTasksOnly}
                      onChange={(e) =>
                        onUpdateFilter("showMainTasksOnly", e.target.checked)
                      }
                      className="rounded border-border text-primary focus:ring-ring"
                    />
                    <span className="text-sm">Main tasks only</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.showSubTasksOnly}
                      onChange={(e) =>
                        onUpdateFilter("showSubTasksOnly", e.target.checked)
                      }
                      className="rounded border-border text-primary focus:ring-ring"
                    />
                    <span className="text-sm">Tasks with subtasks only</span>
                  </label>
                </div>
              </div>

              {/* 액션 버튼들 */}
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onResetFilters}
                  className="w-full"
                  disabled={!hasActiveFilters}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reset All Filters
                </Button>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
};
