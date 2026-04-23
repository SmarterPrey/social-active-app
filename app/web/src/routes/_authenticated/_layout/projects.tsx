import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useRef } from "react";
import { ChevronLeft, ChevronRight, FolderOpen, Search } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { querySearchProjects } from "@/lib/utils";
import { ProjectData } from "@/types/types";
import { toast } from "@/components/ui/use-toast";
import { ProjectDetailDrawer } from "@/components/ProjectDetailDrawer";

const PAGE_SIZE = 10;

export const Route = createFileRoute("/_authenticated/_layout/projects")({
  component: ProjectsPage,
});

function ProjectsPage() {
  const [searchValue, setSearchValue] = useState("");
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedProject, setSelectedProject] = useState<ProjectData | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(projects.length / PAGE_SIZE)),
    [projects.length]
  );

  const paginatedProjects = useMemo(
    () =>
      projects.slice(
        (currentPage - 1) * PAGE_SIZE,
        currentPage * PAGE_SIZE
      ),
    [projects, currentPage]
  );

  const fetchProjects = async (value: string) => {
    setIsLoading(true);
    try {
      const result = await querySearchProjects(value || undefined);
      setProjects(result.data?.searchProjects ?? []);
      setCurrentPage(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Error loading business services",
        description:
          error?.errors?.[0]?.message || error?.message || "An error occurred",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchProjects("");
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchValue(value);

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => {
      fetchProjects(value);
    }, 300);
  };

  return (
    <main className="grid flex-1 items-start gap-4 p-4 sm:px-6 sm:py-0 md:gap-8">
      <Card className="sm:col-span-2">
        <CardHeader className="flex flex-row items-start bg-muted/50">
          <div className="grid gap-0.5">
            <CardTitle className="group flex items-center gap-2 text-lg">
              <FolderOpen className="h-5 w-5" />
              Business Services
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="mb-4">
            <Input
              placeholder="Search business services by name..."
              value={searchValue}
              onChange={handleSearchChange}
              className="max-w-sm"
            />
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" style={{ animationDelay: `${i * 75}ms` }} />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground animate-fade-in">
              {searchValue ? (
                <>
                  <Search className="h-8 w-8 mb-3 opacity-30" />
                  <p className="text-sm font-medium">No matches for "{searchValue}"</p>
                  <p className="text-xs mt-1 opacity-60">Try adjusting your search term or clearing the filter</p>
                </>
              ) : (
                <>
                  <FolderOpen className="h-8 w-8 mb-3 opacity-30" />
                  <p className="text-sm font-medium">No business services registered</p>
                  <p className="text-xs mt-1 opacity-60">Business services will appear here once Project_Data vertices exist in Neptune</p>
                </>
              )}
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Business Service</TableHead>
                    <TableHead>Owner Group</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedProjects.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell className="font-medium">
                        <button
                          className="text-left text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
                          onClick={() => {
                            setSelectedProject(project);
                            setDrawerOpen(true);
                          }}
                        >
                          {project.projectName}
                        </button>
                      </TableCell>
                      <TableCell>{project.OwnerGroup ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination Controls */}
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Showing{" "}
                  {(currentPage - 1) * PAGE_SIZE + 1}–
                  {Math.min(currentPage * PAGE_SIZE, projects.length)} of{" "}
                  {projects.length} business services
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setCurrentPage((p) => Math.min(totalPages, p + 1))
                    }
                    disabled={currentPage === totalPages}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <ProjectDetailDrawer
        project={selectedProject}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </main>
  );
}
