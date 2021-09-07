import React, {useState, useEffect, useCallback} from "react";
import { Box, Label, Input } from "@admin-bro/design-system";
import generateSlug from "../../util/generateSlug";
import { ApiClient } from 'admin-bro';
import * as qs from "qs";

const SlugInput = (props) => {
    const { record, property, resource } = props;
    const api = new ApiClient();

    // referenceField is the field which value is copied from in order to generate the slug
    const referenceField = property.props?.referenceField;

    // basePath is used to display the path for the URL Preview
    const basePath = property.props?.basePath;

    const [populated, setPopulated] = useState(true);
    const [slug, setSlug] = useState(record.params[property.path]);
    const [initialSlug] = useState(record.params[property.path]);

    const setSlugRecordParam = (value) => {
        // Update slug value on Record params, so it's passed to the request body when the form is saved
        record.params[property.path] = value;
    }

    const callAction = async (record, tempSlug) => {
        return await api.recordAction({ recordId: record.id, actionName: 'do-get-slug', resourceId: resource.id, data: qs.stringify({tempSlug}) });
    }

    const populateSlugField = async (inputData) => {
        const { data } = await callAction(record, inputData);
        const newSlug = data.record.params.slug;

        setSlug(newSlug);
        setSlugRecordParam(newSlug);
    }

    useEffect(() => {
        // It should start listening for inheritedField's content changes just after being populated by the current "Slug" value in the DB
        if (!populated) {
            populateSlugField(record.params[referenceField]);
        } else {
            setPopulated(false);
        }


    }, [record.params[referenceField]]);

    const handleChange = useCallback((event) => {
        const newSlug = event.target.value;
        setSlug(newSlug);
        setSlugRecordParam(newSlug);

        event.preventDefault();
    });

    const handleLostFocus = useCallback(async (event) => {
        if (initialSlug === event.target.value) {
            return;
        }
        const tempSlug = generateSlug(event.target.value);
        populateSlugField(tempSlug);
    });

    return (
        <Box>
            <div style={{marginBottom: "32px"}}> 
                <Label required>SEO-optimized name</Label>
                <div style={{display: "flex", alignItems: "center", columnGap:"20px", color:"#999"}}>
                    <Input type="text" onChange={handleChange} onBlur={handleLostFocus} value={slug} />
                    {slug && <p>URL Preview: {`${AdminBro.env.CLIENT_URL}${basePath}${generateSlug(slug)}`}</p>}
                </div>
            </div>
        </Box>
    );
};

export default SlugInput;
