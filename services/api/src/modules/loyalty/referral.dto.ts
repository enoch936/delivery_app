import { IsString, Length } from "class-validator";

export class RedeemReferralDto {
  @IsString()
  @Length(3, 32)
  code!: string;
}
