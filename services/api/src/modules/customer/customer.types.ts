export const CUSTOMER_REPOSITORY = Symbol("CUSTOMER_REPOSITORY");

export type CustomerAddress = Readonly<{
  id: string;
  label: string;
  recipientName: string;
  phoneE164: string;
  addressLine: string;
  deliveryInstructions: string | null;
  isDefault: boolean;
}>;

export interface CustomerRepository {
  listAddresses(userId: string): Promise<readonly CustomerAddress[]>;
  createAddress(userId: string, input: Readonly<Omit<CustomerAddress, "id">>): Promise<CustomerAddress>;
  getAddress(userId: string, addressId: string): Promise<CustomerAddress | null>;
}
