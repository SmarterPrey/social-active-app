export const radioGroupValue = [
  {
    value: "Company",
    label: "Search by Company",
    description: "Find a collision shop, insurance company, or business",
    placeholder: "Enter company name",
  },
  {
    value: "Customer",
    label: "Search by Customer",
    description: "Find a customer by name",
    placeholder: "Enter customer name",
  },
  {
    value: "Estimator",
    label: "Search by Estimator",
    description: "Find an estimator by name",
    placeholder: "Enter estimator name",
  },
  {
    value: "Jobber",
    label: "Search by Jobber",
    description: "Find a parts supplier by company name",
    placeholder: "Enter jobber/supplier name",
  },
  {
    value: "Asset",
    label: "Search by Asset",
    description: "Find a vehicle or asset by make, model, or VIN",
    placeholder: "Enter make, model, or VIN",
  },
  {
    value: "Job",
    label: "Search by Job",
    description: "Find a job by name",
    placeholder: "Enter job name",
  },
  {
    value: "Part",
    label: "Search by Part",
    description: "Find a part by name",
    placeholder: "Enter part name",
  },
];

import { VertexTypeItem, EdgeTypeItem } from "@/types/types";

export const selectVertexItem: VertexTypeItem[] = [
  {
    value: "Entity",
    description: "Entity (Company, Customer, Estimator, Jobber)",
    fields: [
      {
        key: "entityTypes",
        label: "Entity Type",
        type: "select",
        required: true,
        options: ["Company", "Customer", "Estimator", "Jobber"],
      },
      {
        key: "companyName",
        label: "Company Name",
        type: "text",
        placeholder: "For companies and jobbers",
      },
      {
        key: "name",
        label: "Person Name",
        type: "text",
        placeholder: "For customers and estimators",
      },
      {
        key: "companyType",
        label: "Company Type",
        type: "select",
        options: [
          "CollisionShop",
          "InsuranceCompany",
          "Estimator",
          "Jobber",
        ],
      },
      { key: "address", label: "Address", type: "text" },
      { key: "email", label: "Email", type: "text" },
      { key: "phone", label: "Phone", type: "text" },
      { key: "website", label: "Website", type: "text" },
      { key: "country", label: "Country", type: "text" },
    ],
  },
  {
    value: "Asset",
    description: "Asset (Vehicle, Boat, RV, etc.)",
    fields: [
      {
        key: "assetType",
        label: "Asset Type",
        type: "select",
        required: true,
        options: [
          "Vehicle",
          "Boat",
          "JetSki",
          "RV",
          "Motorcycle",
          "EquipmentTrailer",
          "ConstructionEquipment",
          "Airplane",
          "Helicopter",
          "Building",
          "MobileHome",
          "CustomPart",
        ],
      },
      { key: "make", label: "Make", type: "text" },
      { key: "model", label: "Model", type: "text" },
      { key: "year", label: "Year", type: "number" },
      { key: "vin", label: "VIN", type: "text" },
      { key: "serialNumber", label: "Serial Number", type: "text" },
      { key: "brand", label: "Brand", type: "text" },
    ],
  },
  {
    value: "Job",
    description: "Job (Collision Repair, PPF, etc.)",
    fields: [
      { key: "jobName", label: "Job Name", type: "text", required: true },
      {
        key: "jobCategory",
        label: "Category",
        type: "select",
        options: [
          "CollisionRepair",
          "PPF",
          "DetailWash",
          "Tint",
          "Wrap",
          "MechanicalRepair",
          "BoatRepair",
          "RVRepair",
        ],
      },
      {
        key: "status",
        label: "Status",
        type: "select",
        options: ["Open", "InProgress", "Completed", "Invoiced", "Closed"],
      },
      { key: "roNumber", label: "RO Number", type: "text" },
    ],
  },
  {
    value: "Part",
    description: "Part",
    fields: [
      { key: "partName", label: "Part Name", type: "text", required: true },
      { key: "partId", label: "Part ID", type: "text" },
      { key: "retailCost", label: "Retail Cost ($)", type: "number" },
    ],
  },
];

export const selectEdgeItem: EdgeTypeItem[] = [
  {
    value: "WORKS_FOR",
    description: "Works For (Entity → Entity)",
    sourceLabel: "Entity",
    destLabel: "Entity",
    fields: [
      {
        key: "role",
        label: "Role",
        type: "text",
        placeholder: "e.g., Estimator, Painter",
      },
    ],
  },
  {
    value: "REQUESTS_WORK",
    description: "Requests Work (Entity → Entity)",
    sourceLabel: "Entity",
    destLabel: "Entity",
    fields: [],
  },
  {
    value: "DOES_WORK_FOR",
    description: "Does Work For (Entity → Entity)",
    sourceLabel: "Entity",
    destLabel: "Entity",
    fields: [
      {
        key: "serviceType",
        label: "Service Type",
        type: "text",
        placeholder: "e.g., CollisionRepair, PPF",
      },
    ],
  },
  {
    value: "OWNS_ASSET",
    description: "Owns Asset (Entity → Asset)",
    sourceLabel: "Entity",
    destLabel: "Asset",
    fields: [],
  },
  {
    value: "MANAGES_JOB",
    description: "Manages Job (Entity → Job)",
    sourceLabel: "Entity",
    destLabel: "Job",
    fields: [
      {
        key: "role",
        label: "Role",
        type: "text",
        placeholder: "e.g., LeadShop, Estimator",
      },
    ],
  },
  {
    value: "SERVICE_ON",
    description: "Service On (Job → Asset)",
    sourceLabel: "Job",
    destLabel: "Asset",
    fields: [
      {
        key: "serviceType",
        label: "Service Type",
        type: "text",
        placeholder: "e.g., CollisionRepair, PPF",
      },
    ],
  },
  {
    value: "PAYS_FOR",
    description: "Pays For (Entity → Job)",
    sourceLabel: "Entity",
    destLabel: "Job",
    fields: [
      {
        key: "payerType",
        label: "Payer Type",
        type: "text",
        placeholder: "e.g., Insurance, CustomerPay",
      },
      { key: "discountPercent", label: "Discount %", type: "number" },
    ],
  },
  {
    value: "OFFERS_PART",
    description: "Offers Part (Entity → Part)",
    sourceLabel: "Entity",
    destLabel: "Part",
    fields: [
      { key: "discountPercent", label: "Discount %", type: "number" },
      { key: "leadTimeDays", label: "Lead Time (days)", type: "number" },
    ],
  },
  {
    value: "HAS_LINE_ITEM",
    description: "Has Line Item (Job → Part)",
    sourceLabel: "Job",
    destLabel: "Part",
    fields: [
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "unitCost", label: "Unit Cost ($)", type: "number" },
    ],
  },
  {
    value: "JOBBER_FOR_JOB",
    description: "Jobber For Job (Entity → Job)",
    sourceLabel: "Entity",
    destLabel: "Job",
    fields: [
      { key: "discountPercent", label: "Discount %", type: "number" },
    ],
  },
];

export const Profiles = [
  {
    value: "search_name",
    description: "Search word",
  },
  {
    value: "affiliated_with",
    description: "Institution",
  },
  {
    value: "usage",
    description: "Use",
  },
  {
    value: "belong_to",
    description: "Affiliated academic society",
  },
  {
    value: "authored_by",
    description: "Paper",
  },
  {
    value: "people",
    description: "Academic member",
  },
  {
    value: "made_by",
    description: "Pharmaceutical company",
  },
];
