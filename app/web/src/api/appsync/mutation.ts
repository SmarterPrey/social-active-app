export const registerInfo = /* GraphQL */ `
  mutation insertData($InsertDataInput: InsertDataInput!) {
    insertData(input: $InsertDataInput) {
      result
    }
  }
`;

export const addProjectAccountMutation = /* GraphQL */ `
  mutation addProjectAccount($input: AddAccountInput!) {
    addProjectAccount(input: $input) {
      id
      Account_Name
      Account_Id
      Cloud
      Environments
    }
  }
`;

export const deleteProjectAccountMutation = /* GraphQL */ `
  mutation deleteProjectAccount($accountId: String!) {
    deleteProjectAccount(accountId: $accountId) {
      result
    }
  }
`;


