export type AddressRecord = Readonly<{
  id: string;
  label: string;
  recipientName: string;
  phoneE164: string;
  addressLine: string;
  deliveryInstructions: string | null;
  latitude: number | null;
  longitude: number | null;
  serviceZoneId: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}>;
