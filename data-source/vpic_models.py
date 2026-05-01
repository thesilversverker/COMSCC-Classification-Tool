"""
Logical component: pydantic envelopes for the three VPIC endpoints we hit.

Every cached body is parsed into one of these models before downstream code
touches it. This catches schema drift early (NHTSA has been known to silently
add or rename fields) and gives the rest of the pipeline strict types.

Only the fields the projection step actually consumes are modeled. Unknown
fields are tolerated via `model_config = ConfigDict(extra="allow")` so a new
NHTSA field never breaks an in-flight refresh.
"""

from __future__ import annotations

from typing import Generic, List, TypeVar

from pydantic import BaseModel, ConfigDict, Field

# Logical component: shared envelope shape for every VPIC endpoint.
ResultT = TypeVar("ResultT", bound=BaseModel)


class _Lenient(BaseModel):
    """Base for every model: allow extra keys so NHTSA additions don't break refresh."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class _Envelope(_Lenient, Generic[ResultT]):
    """All three endpoints return {Count, Message, SearchCriteria, Results: [...]}."""

    count: int = Field(alias="Count")
    message: str = Field(default="", alias="Message")
    search_criteria: str | None = Field(default=None, alias="SearchCriteria")


# Logical component: GetMakesForVehicleType/car results.
class MakeRow(_Lenient):
    make_id: int = Field(alias="MakeId")
    make_name: str = Field(alias="MakeName")
    vehicle_type_id: int | None = Field(default=None, alias="VehicleTypeId")
    vehicle_type_name: str | None = Field(default=None, alias="VehicleTypeName")


class MakesEnvelope(_Envelope[MakeRow]):
    results: List[MakeRow] = Field(default_factory=list, alias="Results")


# Logical component: GetModelsForMakeYear/make/{make}/modelyear/{year} results.
class ModelRow(_Lenient):
    make_id: int = Field(alias="Make_ID")
    make_name: str = Field(alias="Make_Name")
    model_id: int = Field(alias="Model_ID")
    model_name: str = Field(alias="Model_Name")


class ModelsEnvelope(_Envelope[ModelRow]):
    results: List[ModelRow] = Field(default_factory=list, alias="Results")


# Logical component: GetCanadianVehicleSpecifications results.
# Each result is a thin wrapper around a Specs list of {Name, Value} rows.
class SpecsKV(_Lenient):
    name: str = Field(alias="Name")
    value: str | None = Field(default=None, alias="Value")


class CanadianSpecRow(_Lenient):
    specs: List[SpecsKV] = Field(default_factory=list, alias="Specs")


class CanadianSpecsEnvelope(_Envelope[CanadianSpecRow]):
    results: List[CanadianSpecRow] = Field(default_factory=list, alias="Results")


# Logical component: tagged-union helper so callers can request the right model
# by endpoint name without re-importing every class.
ENDPOINT_MODEL = {
    "GetMakesForVehicleType": MakesEnvelope,
    "GetModelsForMakeYear": ModelsEnvelope,
    "GetCanadianVehicleSpecifications": CanadianSpecsEnvelope,
}


def parse_envelope(endpoint: str, body: dict):
    """Pick the right pydantic envelope for the endpoint and parse `body`.

    Raises pydantic.ValidationError on schema drift.
    """
    model_cls = ENDPOINT_MODEL.get(endpoint)
    if model_cls is None:
        raise ValueError(f"Unknown VPIC endpoint: {endpoint}")
    return model_cls.model_validate(body)
