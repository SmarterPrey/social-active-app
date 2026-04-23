import { z } from "zod";
import { useState, useEffect } from "react";
import { Icons } from "@/lib/utils";
import { useForm } from "react-hook-form";
import { generateClient } from "aws-amplify/api";
import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "@/components/ui/use-toast";
import { Input } from "@/components/ui/input";
import { registerInfo } from "@/api/appsync/mutation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { selectEdgeItem, selectVertexItem } from "@/data/data";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ErrorMessage, InsertDataInput, FieldDefinition } from "@/types/types";

export const Route = createFileRoute("/_authenticated/_layout/register")({
  component: Register,
});

const FormSchema = z.object({
  type: z.enum(["vertex", "edge"], {
    required_error: "You need to select a type.",
  }),
});

const radioGroupValue = [
  {
    type: "vertex",
  },
  {
    type: "edge",
  },
];

/** Return a helpful placeholder for source/destination inputs */
const getIdentifierPlaceholder = (label: string) => {
  switch (label) {
    case "Entity":
      return "Enter name or company name";
    case "Asset":
      return "Enter asset ID (e.g., asset_veh_1)";
    case "Job":
      return "Enter job name";
    case "Part":
      return "Enter part name";
    default:
      return "Enter name or ID";
  }
};

function Register() {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [mode, setMode] = useState("vertex");
  const [selectedType, setSelectedType] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");

  const client = generateClient();

  // Look up the current type definition
  const currentVertexType = selectVertexItem.find(
    (v) => v.value === selectedType
  );
  const currentEdgeType = selectEdgeItem.find(
    (e) => e.value === selectedType
  );
  const currentFields: FieldDefinition[] =
    mode === "vertex"
      ? currentVertexType?.fields ?? []
      : currentEdgeType?.fields ?? [];

  // Reset fields when selected type changes
  useEffect(() => {
    setFieldValues({});
    setSource("");
    setDestination("");
  }, [selectedType]);

  // Reset everything when mode (vertex/edge) changes
  useEffect(() => {
    setSelectedType("");
    setFieldValues({});
    setSource("");
    setDestination("");
  }, [mode]);

  const updateField = (key: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  };

  const onSubmitRegister = async () => {
    setIsLoading(true);

    try {
      if (!selectedType) {
        toast({
          variant: "destructive",
          title: "Register error",
          description: "Please select a type first",
        });
        setIsLoading(false);
        return;
      }

      if (mode === "vertex") {
        // Check required fields
        const missing = currentFields.filter(
          (f) => f.required && !fieldValues[f.key]
        );
        if (missing.length > 0) {
          toast({
            variant: "destructive",
            title: "Register error",
            description: `${missing[0].label} is required`,
          });
          setIsLoading(false);
          return;
        }
      } else {
        if (!source || !destination) {
          toast({
            variant: "destructive",
            title: "Register error",
            description: "Source and destination are required",
          });
          setIsLoading(false);
          return;
        }
      }

      // Build properties object - convert number fields to actual numbers
      const properties: Record<string, unknown> = {};
      for (const field of currentFields) {
        const val = fieldValues[field.key];
        if (val !== undefined && val !== "") {
          if (field.type === "number") {
            properties[field.key] = Number(val);
          } else {
            properties[field.key] = val;
          }
        }
      }

      const input: InsertDataInput = {
        value: mode,
        vertex: mode === "vertex" ? selectedType : undefined,
        edge: mode === "edge" ? selectedType : undefined,
        source: mode === "edge" ? source : undefined,
        sourceLabel: currentEdgeType?.sourceLabel,
        destination: mode === "edge" ? destination : undefined,
        destLabel: currentEdgeType?.destLabel,
        properties: JSON.stringify(properties),
      };

      console.log(input);
      await client.graphql({
        query: registerInfo,
        variables: {
          InsertDataInput: input,
        },
      });
      toast({
        title: `Successfully registered ${mode}`,
      });
      setFieldValues({});
      setSource("");
      setDestination("");
      setIsLoading(false);
    } catch (error) {
      const errorMessage = error as ErrorMessage;
      toast({
        variant: "destructive",
        title: "Register error",
        description: errorMessage.message,
      });
      setIsLoading(false);
    }
  };

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
  });

  return (
    <main className="grid items-start gap-4 p-4 sm:px-6 sm:py-0 md:gap-8 lg:grid-cols-2 xl:grid-cols-2">
      <div className="col-span-2 gap-2 sm:grid-cols-1 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-2">
        <Card className="sm:col-span-4" x-chunk="dashboard-05-chunk-0">
          <CardHeader className="flex flex-row items-start">
            <div className="grid gap-0.5">
              <CardTitle className="group flex items-center gap-2 text-lg">
                Vertex/Edge Registration
              </CardTitle>
              <CardDescription className="text-start">
                Register vertices (Entity, Asset, Job, Part) or edges to Amazon
                Neptune. Select the type, fill in the properties, and submit.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-6 ">
            <Form {...form}>
              <form className="flex flex-col">
                <div className="flex flex-row justify-evenly ">
                  <FormField
                    control={form.control}
                    name="type"
                    render={() => (
                      <FormItem className="space-y-3">
                        <FormControl>
                          <RadioGroup
                            onValueChange={(curr) => setMode(curr)}
                            defaultValue="vertex"
                            className="flex flex-col space-y-1"
                          >
                            {radioGroupValue.map((object, index: number) => (
                              <FormItem
                                className="flex items-start space-x-3 space-y-0"
                                key={index.toString()}
                              >
                                <FormControl>
                                  <RadioGroupItem value={object.type} />
                                </FormControl>
                                <FormLabel className="">
                                  {object.type}
                                </FormLabel>
                              </FormItem>
                            ))}
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="">
                    <div className="grid gap-6">
                      <div className="grid gap-3">
                        <Select
                          value={selectedType}
                          onValueChange={(val) => setSelectedType(val)}
                        >
                          <SelectTrigger
                            id="type"
                            aria-label={
                              mode === "vertex"
                                ? "Select vertex label"
                                : "Select edge type"
                            }
                            className="w-[300px]"
                          >
                            <SelectValue
                              placeholder={
                                mode === "vertex"
                                  ? "Select vertex label"
                                  : "Select edge type"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {mode === "vertex"
                              ? selectVertexItem.map((item, index: number) => (
                                  <SelectItem
                                    value={item.value}
                                    key={index.toString()}
                                  >
                                    {item.description}
                                  </SelectItem>
                                ))
                              : selectEdgeItem.map((item, index: number) => (
                                  <SelectItem
                                    value={item.value}
                                    key={index.toString()}
                                  >
                                    {item.description}
                                  </SelectItem>
                                ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Dynamic fields based on selected type */}
                {selectedType && (
                  <div className="flex flex-col py-8 space-y-4">
                    {/* Edge: source/destination inputs */}
                    {mode === "edge" && currentEdgeType && (
                      <div className="flex flex-row space-x-4">
                        <Input
                          placeholder={`Source (${currentEdgeType.sourceLabel}) \u2014 ${getIdentifierPlaceholder(currentEdgeType.sourceLabel)}`}
                          value={source}
                          onChange={(e) => setSource(e.target.value)}
                          disabled={isLoading}
                          className="flex-1"
                        />
                        <Input
                          placeholder={`Destination (${currentEdgeType.destLabel}) \u2014 ${getIdentifierPlaceholder(currentEdgeType.destLabel)}`}
                          value={destination}
                          onChange={(e) => setDestination(e.target.value)}
                          disabled={isLoading}
                          className="flex-1"
                        />
                      </div>
                    )}

                    {/* Render property fields in a grid */}
                    {currentFields.length > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {currentFields.map((field) => (
                          <div key={field.key}>
                            {field.type === "select" ? (
                              <Select
                                value={fieldValues[field.key] || ""}
                                onValueChange={(val) =>
                                  updateField(field.key, val)
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue
                                    placeholder={`${field.label}${field.required ? " *" : ""}`}
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  {field.options?.map((opt) => (
                                    <SelectItem key={opt} value={opt}>
                                      {opt}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                type={field.type === "number" ? "number" : "text"}
                                placeholder={`${field.label}${field.required ? " *" : ""}${field.placeholder ? " \u2014 " + field.placeholder : ""}`}
                                value={fieldValues[field.key] || ""}
                                onChange={(e) =>
                                  updateField(field.key, e.target.value)
                                }
                                disabled={isLoading}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-end">
                  <Button
                    className="items-left"
                    onClick={onSubmitRegister}
                    disabled={isLoading || !selectedType}
                  >
                    {isLoading && (
                      <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Submit
                  </Button>
                </div>
              </form>
            </Form>

            {/* Edge breadcrumb visualization */}
            {mode === "edge" && currentEdgeType && (source || destination) ? (
              <div className="flex justify-center py-8">
                <Breadcrumb className="">
                  <BreadcrumbList>
                    <BreadcrumbItem>
                      <Card>
                        <CardHeader className="pb-2">
                          <CardDescription>Source</CardDescription>
                          <CardTitle className="text-2xl">
                            {currentEdgeType.sourceLabel}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-lg text-muted-foreground">
                            {source || "\u2014"}
                          </div>
                        </CardContent>
                      </Card>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <Card>
                        <CardHeader className="pb-2">
                          <CardDescription>Edge</CardDescription>
                          <CardTitle className="text-lg">
                            {selectedType}
                          </CardTitle>
                        </CardHeader>
                      </Card>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>
                        <Card>
                          <CardHeader className="pb-2">
                            <CardDescription>Destination</CardDescription>
                            <CardTitle className="text-2xl">
                              {currentEdgeType.destLabel}
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="text-lg text-muted-foreground">
                              {destination || "\u2014"}
                            </div>
                          </CardContent>
                        </Card>
                      </BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            ) : (
              <></>
            )}
            <></>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
